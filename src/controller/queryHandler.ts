import {InsightDataset, InsightError, InsightResult, ResultTooLargeError, InsightDatasetKind} from "./IInsightFacade";
import * as fs from "fs-extra";
import Decimal from "decimal.js";

export class queryHandler {

	// Constants for Section Calculations
	private overallNumber = 1900;
	private resultLimit = 5000;

	// Fields Schemas configuration for Sections
	private sectionsMFields = ["avg", "pass", "fail", "audit", "year"];
	private sectionsSFields = ["dept", "id", "instructor", "title", "uuid"];

	// Fields Schemas configuration for Rooms
	private roomsMFields = ["lat", "lon", "seats"];
	private roomsSFields = ["fullname", "shortname", "number", "name", "address", "type", "furniture", "href"];

	// Internal mappings for programmatic resolution
	private fieldToKey: { [key: string]: string } = {
		avg: "Avg",
		pass: "Pass",
		fail: "Fail",
		audit: "Audit",
		year: "Year",
		dept: "Subject",
		id: "Course",
		instructor: "Professor",
		title: "Title",
		uuid: "id",
		lat: "lat",
		lon: "lon",
		seats: "seats",
		fullname: "fullname",
		shortname: "shortname",
		number: "number",
		name: "name",
		address: "address",
		type: "type",
		furniture: "furniture",
		href: "href",
	};

	private datasets: Map<string, InsightDataset>;
	private currentQueryId: string;

	constructor(datasets: Map<string, InsightDataset>) {
		this.datasets = datasets;
		this.currentQueryId = "";
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		if (!this.isQueryValid(query)) {
			throw new InsightError("Invalid Query");
		}

		const queryObj = query as any;
		const id = this.extractDatasetId(queryObj.OPTIONS.COLUMNS[0]);
		const rawData = await this.loadDatasetFromDisk(id);

		const filteredData = rawData.filter((row: any) => {
			if (Object.keys(queryObj.WHERE).length === 0) return true;
			return this.isRowValid(row, queryObj.WHERE);
		});

		let processedResults: InsightResult[] = [];
		if (queryObj.TRANSFORMATIONS) {
			processedResults = this.executeTransformations(
				filteredData,
				queryObj.TRANSFORMATIONS,
				queryObj.OPTIONS.COLUMNS
			);
		} else {
			processedResults = filteredData.map((row) => this.mapColumns(row, queryObj.OPTIONS.COLUMNS));
		}

		if (processedResults.length > this.resultLimit) {
			throw new ResultTooLargeError();
		}

		if (queryObj.OPTIONS.ORDER) {
			this.applySort(processedResults, queryObj.OPTIONS.ORDER);
		}

		return processedResults;
	}

	private async loadDatasetFromDisk(id: string): Promise<any[]> {
		try {
			const path = `./data/${id}.json`;
			const persisted = await fs.readJson(path);
			return persisted.data;
		} catch (_err) {
			throw new InsightError(`Could not read dataset ${id} from disk`);
		}
	}

	private validateKey(key: any, type?: "mfield" | "sfield"): boolean {
		if (typeof key !== "string") return false;
		const parts = key.split("_");
		if (parts.length !== 2) return false;

		const id = parts[0];
		const field = parts[1];

		if (this.currentQueryId === "") {
			this.currentQueryId = id;
		} else if (this.currentQueryId !== id) {
			return false;
		}

		if (!this.datasets.has(id)) return false;
		const kind = this.datasets.get(id)!.kind;

		const mfields = kind === InsightDatasetKind.Sections ? this.sectionsMFields : this.roomsMFields;
		const sfields = kind === InsightDatasetKind.Sections ? this.sectionsSFields : this.roomsSFields;

		if (type === "mfield") return mfields.includes(field);
		if (type === "sfield") return sfields.includes(field);

		return mfields.includes(field) || sfields.includes(field);
	}

	private isLogicComparisonValid(filterList: any): boolean {
		if (!Array.isArray(filterList) || filterList.length === 0) return false;
		for (const filter of filterList) {
			if (!this.isFilterValid(filter)) return false;
		}
		return true;
	}

	private isMComparisonValid(mcomp: any): boolean {
		if (typeof mcomp !== "object" || mcomp === null) return false;
		const keys = Object.keys(mcomp);
		if (keys.length !== 1) return false;
		const mkey = keys[0];
		if (typeof mcomp[mkey] !== "number") return false;
		return this.validateKey(mkey, "mfield");
	}

	private isSComparisonValid(scomp: any): boolean {
		if (typeof scomp !== "object" || scomp === null) return false;
		const keys = Object.keys(scomp);
		if (keys.length !== 1) return false;
		const skey = keys[0];
		if (typeof scomp[skey] !== "string") return false;
		return this.validateKey(skey, "sfield");
	}

	private isNegationValid(notVal: any): boolean {
		if (typeof notVal !== "object" || notVal === null || Array.isArray(notVal)) return false;
		if (Object.keys(notVal).length !== 1) return false;
		return this.isFilterValid(notVal);
	}

	private isFilterValid(filter: any): boolean {
		if (typeof filter !== "object" || filter === null || Array.isArray(filter)) return false;
		const keys = Object.keys(filter);
		if (keys.length !== 1) return false;

		const key = keys[0];
		if (key === "AND" || key === "OR") return this.isLogicComparisonValid(filter[key]);
		if (key === "GT" || key === "LT" || key === "EQ") return this.isMComparisonValid(filter[key]);
		if (key === "IS") return this.isSComparisonValid(filter[key]);
		if (key === "NOT") return this.isNegationValid(filter[key]);

		return false;
	}

	private isRowValid(row: any, filter: any): boolean {
		const key = Object.keys(filter)[0];
		const content = filter[key];

		switch (key) {
			case "AND":
				return content.every((subFilter: any) => this.isRowValid(row, subFilter));
			case "OR":
				return content.some((subFilter: any) => this.isRowValid(row, subFilter));
			case "NOT":
				return !this.isRowValid(row, content);
			case "GT":
				return this.handleMComp(row, content, (a, b) => a > b);
			case "LT":
				return this.handleMComp(row, content, (a, b) => a < b);
			case "EQ":
				return this.handleMComp(row, content, (a, b) => a === b);
			case "IS":
				return this.handleSComp(row, content);
			default:
				return true;
		}
	}

	private handleMComp(row: any, comparison: any, op: (a: number, b: number) => boolean): boolean {
		const queryKey = Object.keys(comparison)[0];
		const targetValue = comparison[queryKey];
		const parts = queryKey.split("_");
		const id = parts[0];
		const field = parts[1];

		const kind = this.datasets.get(id)!.kind;

		let sectionValue = row[this.fieldToKey[field]];

		if (kind === InsightDatasetKind.Sections && field === "year") {
			sectionValue = row.Section === "overall" ? 1900 : parseInt(sectionValue, 10);
		}

		return op(Number(sectionValue), targetValue);
	}

	private handleSComp(section: any, comparison: any): boolean {
		const queryKey = Object.keys(comparison)[0];
		const field = queryKey.split("_")[1];
		const inputString = comparison[queryKey];
		const sectionValue = String(section[this.fieldToKey[field]]);

		let regString = inputString.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		regString = "^" + regString.replace(/\*/g, ".*") + "$";
		return new RegExp(regString).test(sectionValue);
	}

	private isTransformationsValid(transform: any, columns: string[]): boolean {
		if (typeof transform !== "object" || transform === null || Array.isArray(transform)) return false;
		const keys = Object.keys(transform);
		if (keys.length !== 2 || !keys.includes("GROUP") || !keys.includes("APPLY")) return false;

		const group = transform.GROUP;
		const apply = transform.APPLY;

		if (!Array.isArray(group) || group.length === 0) return false;
		for (const groupKey of group) {
			if (!this.validateKey(groupKey)) return false;
		}

		if (!Array.isArray(apply)) return false;
		const seenApplyKeys = new Set<string>();
		const validTokens = ["MAX", "MIN", "AVG", "COUNT", "SUM"];

		for (const applyRule of apply) {
			if (typeof applyRule !== "object" || applyRule === null || Array.isArray(applyRule)) return false;
			const ruleKeys = Object.keys(applyRule);
			if (ruleKeys.length !== 1) return false;

			const applyKey = ruleKeys[0];
			if (applyKey.includes("_") || applyKey.length === 0 || seenApplyKeys.has(applyKey)) return false;
			seenApplyKeys.add(applyKey);

			const tokenObj = applyRule[applyKey];
			if (typeof tokenObj !== "object" || tokenObj === null || Array.isArray(tokenObj)) return false;
			const tokenKeys = Object.keys(tokenObj);
			if (tokenKeys.length !== 1 || !validTokens.includes(tokenKeys[0])) return false;

			const token = tokenKeys[0];
			const targetKey = tokenObj[token];

			if (token === "AVG" || token === "SUM" || token === "MAX" || token === "MIN") {
				if (!this.validateKey(targetKey, "mfield")) return false;
			} else if (token === "COUNT") {
				if (!this.validateKey(targetKey)) return false;
			}
		}

		for (const col of columns) {
			if (!group.includes(col) && !seenApplyKeys.has(col)) return false;
		}

		return true;
	}

	private isOptionsValid(options: any, hasTransform: boolean): boolean {
		if (typeof options !== "object" || options === null || Array.isArray(options)) return false;
		if (!Object.keys(options).includes("COLUMNS") || !Array.isArray(options.COLUMNS) || options.COLUMNS.length === 0)
			return false;

		for (const columnKey of options.COLUMNS) {
			if (columnKey.includes("_")) {
				if (!this.validateKey(columnKey)) return false;
			}
		}

		if (Object.keys(options).includes("ORDER")) {
			const order = options.ORDER;
			if (typeof order === "string") {
				if (!options.COLUMNS.includes(order)) return false;
			} else if (typeof order === "object" && order !== null && !Array.isArray(order)) {
				const orderKeys = Object.keys(order);
				if (orderKeys.length !== 2 || !orderKeys.includes("dir") || !orderKeys.includes("keys")) return false;
				if (order.dir !== "UP" && order.dir !== "DOWN") return false;
				if (!Array.isArray(order.keys) || order.keys.length === 0) return false;
				for (const k of order.keys) {
					if (!options.COLUMNS.includes(k)) return false;
				}
			} else {
				return false;
			}
		}

		const validOptionsKeys = ["COLUMNS", "ORDER"];
		return !Object.keys(options).some((k) => !validOptionsKeys.includes(k));
	}

	private isQueryValid(query: any): boolean {
		const keys = Object.keys(query);
		const hasTransform = keys.includes("TRANSFORMATIONS");

		if (keys.length === 2 && keys.includes("WHERE") && keys.includes("OPTIONS")) {
			// standard C1 path
		} else if (keys.length === 3 && keys.includes("WHERE") && keys.includes("OPTIONS") && hasTransform) {
			// standard C2 transformations path
		} else {
			return false;
		}

		if (Object.keys(query.WHERE).length > 0 && !this.isFilterValid(query.WHERE)) return false;
		if (!this.isOptionsValid(query.OPTIONS, hasTransform)) return false;
		if (hasTransform && !this.isTransformationsValid(query.TRANSFORMATIONS, query.OPTIONS.COLUMNS)) return false;

		return true;
	}

	private extractValue(section: any, key: string): any {
		const field = key.split("_")[1];
		let value = section[this.fieldToKey[field]];
		if (field === "year") {
			value = section.Section === "overall" ? this.overallNumber : parseInt(value, 10);
		}
		if (field === "uuid") {
			value = String(value);
		}
		return value;
	}

	private executeTransformations(filteredData: any[], transformations: any, columns: string[]): InsightResult[] {
		const groupKeys: string[] = transformations.GROUP;
		const applyRules: any[] = transformations.APPLY;

		const groups = this.partitionIntoGroups(filteredData, groupKeys);
		const finalResults: InsightResult[] = [];

		for (const [bucketId, bucketRows] of groups.entries()) {
			const representativeRow = bucketRows[0];
			const resultRecord: InsightResult = {};

			for (const gk of groupKeys) {
				resultRecord[gk] = this.extractValue(representativeRow, gk);
			}

			const aggregations = this.applyTransformations(bucketRows, applyRules);
			Object.assign(resultRecord, aggregations);

			const filteredRecord: InsightResult = {};
			for (const col of columns) {
				if (resultRecord[col] !== undefined) {
					filteredRecord[col] = resultRecord[col];
				}
			}
			finalResults.push(filteredRecord);
		}

		return finalResults;
	}

	private partitionIntoGroups(filteredData: any[], groupKeys: string[]): Map<string, any[]> {
		const groupBucketsMap = new Map<string, any[]>();

		for (const row of filteredData) {
			const rowValuesList = groupKeys.map((key) => {
				const extractedVal = this.extractValue(row, key);
				return String(extractedVal);
			});

			const compoundBucketKey = rowValuesList.join(" | ");

			if (!groupBucketsMap.has(compoundBucketKey)) {
				groupBucketsMap.set(compoundBucketKey, []);
			}
			groupBucketsMap.get(compoundBucketKey)!.push(row);
		}

		return groupBucketsMap;
	}

	private applyTransformations(bucketRows: any[], applyRules: any[]): Record<string, number> {
		const results: Record<string, number> = {};

		for (const rule of applyRules) {
			const applyKey = Object.keys(rule)[0];
			const tokenObj = rule[applyKey];
			const token = Object.keys(tokenObj)[0];
			const targetKey = tokenObj[token];

			if (token === "MAX") {
				results[applyKey] = Math.max(...bucketRows.map((r) => this.extractValue(r, targetKey)));
			} else if (token === "MIN") {
				results[applyKey] = Math.min(...bucketRows.map((r) => this.extractValue(r, targetKey)));
			} else if (token === "COUNT") {
				const uniqueValues = new Set(bucketRows.map((r) => this.extractValue(r, targetKey)));
				results[applyKey] = uniqueValues.size;
			} else if (token === "SUM") {
				let sum = new Decimal(0);
				for (const row of bucketRows) {
					sum = sum.add(new Decimal(this.extractValue(row, targetKey)));
				}
				results[applyKey] = Number(sum.toFixed(2));
			} else if (token === "AVG") {
				let sum = new Decimal(0);
				for (const row of bucketRows) {
					sum = sum.add(new Decimal(this.extractValue(row, targetKey)));
				}
				const avg = sum.dividedBy(bucketRows.length);
				results[applyKey] = Number(avg.toFixed(2));
			}
		}
		return results;
	}

	private extractDatasetId(key: string): string {
		return key.split("_")[0];
	}

	private mapColumns(row: any, columns: string[]): InsightResult {
		const res: InsightResult = {};
		for (const col of columns) {
			res[col] = this.extractValue(row, col);
		}
		return res;
	}

	private applySort(results: InsightResult[], order: any): void {
		let sortKeys: string[] = [];
		let isDescending = false;

		if (typeof order === "string") {
			sortKeys = [order];
		} else {
			sortKeys = order.keys;
			isDescending = order.dir === "DOWN";
		}

		results.sort((a, b) => {
			for (const key of sortKeys) {
				if (a[key] > b[key]) return isDescending ? -1 : 1;
				if (a[key] < b[key]) return isDescending ? 1 : -1;
			}
			return 0;
		});
	}
}
