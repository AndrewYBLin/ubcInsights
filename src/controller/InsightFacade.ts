import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightError,
	InsightResult,
	NotFoundError,
	ResultTooLargeError,
} from "./IInsightFacade";
import JSZip from "jszip";
import * as fs from "fs-extra";
import * as parse5 from "parse5";
import Decimal from "decimal.js";
import { group } from "console";
import { IDatasetParser } from "./IDatasetParser";
import { SectionsParser } from "./SectionsParser";
import { RoomsParser } from "./RoomsParser";

// Internal structure used to save dataset state to disk along with its metadata
interface PersistedDataset {
	id: string;
	kind: InsightDatasetKind;
	rows: any[];
}

export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, InsightDataset>;
	private currentQueryId: string;
	private initialized = false;

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

	constructor() {
		this.datasets = new Map<string, InsightDataset>();
		this.currentQueryId = "";
	}

	private async initializeDatasets(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		if (await fs.pathExists("./data")) {
			const files = await fs.readdir("./data");
			const jsonFiles = files.filter((file) => file.endsWith(".json"));

			const readPromises = jsonFiles.map(async (fileName) => {
				return fs
					.readJson(`./data/${fileName}`)
					.then((meta: PersistedDataset) => {
						return {
							id: meta.id,
							kind: meta.kind,
							numRows: meta.rows.length,
						};
					})
					.catch(() => null);
			});

			try {
				const results = await Promise.all(readPromises);
				for (const res of results) {
					if (res) {
						this.datasets.set(res.id, {
							id: res.id,
							kind: res.kind,
							numRows: res.numRows,
						});
					}
				}
			} catch (_err) {
				// Silently skip corrupted loads
			}
		}
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		// validation
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			return Promise.reject(new InsightError("Invalid id"));
		}
		if (this.datasets.has(id)) {
			return Promise.reject(new InsightError("ID already exists"));
		}
		if (content === null || content === undefined) {
			throw new InsightError("No content provided");
		}

		// unzipping
		let loadedZip: JSZip;
		try {
			loadedZip = await new JSZip().loadAsync(content, { base64: true });
		} catch (_err) {
			throw new InsightError("Data couldn't be unzipped!");
		}

		// strategy pattern
		let parser: IDatasetParser;
		if (kind === InsightDatasetKind.Sections) {
			parser = new SectionsParser();
		} else {
			parser = new RoomsParser();
		}

		const dataToStore = await parser.parse(loadedZip);

		if (dataToStore.length === 0) {
			throw new InsightError("No valid elements parsed inside archive");
		}

		// persistence
		await fs.ensureDir("./data");
		const persistencePayload: PersistedDataset = { id, kind, rows: dataToStore };
		await fs.writeJson(`./data/${id}.json`, persistencePayload);

		this.datasets.set(id, { id, kind, numRows: dataToStore.length });

		this.initialized = true;
		return Array.from(this.datasets.keys());
	}

	public async removeDataset(id: string): Promise<string> {
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			return Promise.reject(new InsightError("Invalid id"));
		}
		if (!this.datasets.has(id)) {
			return Promise.reject(new NotFoundError("id not found"));
		}

		this.datasets.delete(id);
		try {
			await fs.remove(`./data/${id}.json`);
		} catch (_err) {
			return Promise.reject(new InsightError("Failed to delete data"));
		}
		this.initialized = true;
		return id;
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		// 1. Validation (as you already have)
		if (typeof query !== "object" || query === null || Array.isArray(query)) {
			throw new InsightError("Error: Query is not an object");
		}

		if (!this.isQueryValid(query)) {
			throw new InsightError("Invalid query");
		}

		// Cast after validation
		const queryObj = query as any;

		// 2. Data Retrieval (extract ID from query key dynamically)
		// const id = this.extractDatasetId(queryObj.OPTIONS.COLUMNS[0]);
		const keys = queryObj.TRANSFORMATIONS?.GROUP ?? queryObj.OPTIONS.COLUMNS;
		const idKey = keys.find((k: string) => k.includes("_"));
		if (!idKey) throw new InsightError("Cannot determine dataset id");
		const id = idKey.split("_")[0];

		const rawData = await this.loadDatasetFromDisk(id);

		// 3. Filter (WHERE)
		const where = queryObj.WHERE;
		const filteredData =
			Object.keys(where).length === 0 ? rawData : rawData.filter((row: any) => this.isRowValid(row, where));

		// 4. Transformation Logic (GROUP & APPLY)
		const results: InsightResult[] = queryObj.TRANSFORMATIONS
			? // This is the new branch for C2
				this.executeTransformations(filteredData, queryObj.TRANSFORMATIONS, queryObj.OPTIONS.COLUMNS)
			: // Fallback for simple C1 queries
				filteredData.map((row) => this.mapColumns(row, queryObj.OPTIONS.COLUMNS));

		// 5. Result Limit Check
		if (results.length > this.resultLimit) {
			throw new ResultTooLargeError();
		}

		// 6. Sorting (ORDER)
		if (queryObj.OPTIONS.ORDER) {
			this.applySort(results, queryObj.OPTIONS.ORDER);
		}

		return results;
	}

	// QUERY VALIDATION START
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

	// Filter validation helpers
	private isFilterValid(filter: any): boolean {
		if (typeof filter !== "object" || filter === null || Array.isArray(filter)) return false;
		const keys = Object.keys(filter);
		if (keys.length !== 1) return false;

		const key = keys[0];
		if (key === "AND" || key === "OR") return this.isLogicComparisonValid(filter[key]);
		if (key === "GT" || key === "LT" || key === "EQ") return this.isComparisonValid(filter[key], "number", "mfield");
		if (key === "IS") return this.isComparisonValid(filter[key], "string", "sfield");
		if (key === "NOT") return this.isNegationValid(filter[key]);

		return false;
	}

	private isLogicComparisonValid(filterList: any): boolean {
		if (!Array.isArray(filterList) || filterList.length === 0) return false;
		for (const filter of filterList) {
			if (!this.isFilterValid(filter)) return false;
		}
		return true;
	}

	private isComparisonValid(comp: any, valueType: "number" | "string", fieldKind: "mfield" | "sfield"): boolean {
		if (typeof comp !== "object" || comp === null) return false;
		const keys = Object.keys(comp);
		if (keys.length !== 1) return false;
		const key = keys[0];
		if (typeof comp[key] !== valueType) return false;
		return this.validateKey(key, fieldKind);
	}

	private isNegationValid(notVal: any): boolean {
		if (typeof notVal !== "object" || notVal === null || Array.isArray(notVal)) return false;
		if (Object.keys(notVal).length !== 1) return false;
		return this.isFilterValid(notVal);
	}

	// Misc validation helpers
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

	// --- C2 TRANSFORMATIONS VALIDATION ENGINE ---
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

		// Check that all elements inside COLUMNS are either in GROUP or are defined in APPLY rules
		for (const col of columns) {
			if (!group.includes(col) && !seenApplyKeys.has(col)) return false;
		}

		return true;
	}
	// QUERY VALIDATION END

	// QUERY HANDLING START

	// Where filter handling
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

		// 1. Get the dataset kind dynamically from your storage map
		const kind = this.datasets.get(id)!.kind;

		// 2. Fetch the raw value (use your existing mapping dictionary)
		let sectionValue = row[this.fieldToKey[field]];

		// 3. Apply dataset-specific logic only when necessary
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

	// Transformation logic
	private executeTransformations(filteredData: any[], transformations: any, columns: string[]): InsightResult[] {
		const groupKeys: string[] = transformations.GROUP;
		const applyRules: any[] = transformations.APPLY;

		// Use the grouping helper we discussed previously
		const groups = this.partitionIntoGroups(filteredData, groupKeys);
		const finalResults: InsightResult[] = [];

		for (const bucketRows of groups.values()) {
			const representative = bucketRows[0];
			const record: InsightResult = {};

			// A. Add GROUP keys
			for (const gk of groupKeys) {
				record[gk] = this.extractValue(representative, gk);
			}

			// B. Add APPLY computed keys
			const aggregations = this.applyTransformations(bucketRows, applyRules);
			Object.assign(record, aggregations);

			// C. Add only requested columns
			const projected: InsightResult = {};
			for (const col of columns) {
				if (record[col] !== undefined) {
					projected[col] = record[col];
				}
			}
			finalResults.push(projected);
		}

		return finalResults;
	}

	/**
	 * Partitions row records into collections sharing exact matching field properties.
	 * @param filteredData The filtered dataset array right after the WHERE clause step.
	 * @param groupKeys An array of query keys to group by (e.g., ["sections_dept", "sections_id"])
	 * @returns A Map where each compound string key points to an array of matching rows.
	 */
	private partitionIntoGroups(filteredData: any[], groupKeys: string[]): Map<string, any[]> {
		const groups = new Map<string, any[]>();

		for (const row of filteredData) {
			// 1. Map each target group key to its explicit string value representation
			// 2. Combine the gathered field fragments using a safe string delimiter signature
			// Example output signature: "cpsc | 310" or "DMP | 110"
			const bucketKey = groupKeys.map((key) => String(this.extractValue(row, key))).join(" | ");

			// 3. Insert or push the entry record into its corresponding group sub-collection
			if (!groups.has(bucketKey)) {
				groups.set(bucketKey, []);
			}
			groups.get(bucketKey)!.push(row);
		}

		return groups;
	}

	private applyTransformations(bucketRows: any[], applyRules: any[]): Record<string, number> {
		const results: Record<string, number> = {};

		for (const rule of applyRules) {
			// rule format: { "maxSeats": { "MAX": "rooms_seats" } }
			const applyKey = Object.keys(rule)[0];
			const tokenObj = rule[applyKey];
			const token = Object.keys(tokenObj)[0];
			const targetKey = tokenObj[token];
			const values = bucketRows.map((r) => Number(this.extractValue(r, targetKey)));

			switch (token) {
				case "MAX":
					results[applyKey] = values.reduce((a, b) => Math.max(a, b), values[0] ?? 0);
					break;
				case "MIN":
					results[applyKey] = Math.min(...values.map(Number));
					break;
				case "AVG": {
					const total = values.reduce((sum, v) => sum.add(new Decimal(Number(v))), new Decimal(0));
					results[applyKey] = Number(total.div(bucketRows.length).toFixed(2));
					break;
				}
				case "SUM": {
					const total = values.reduce((sum, v) => sum.add(new Decimal(Number(v))), new Decimal(0));
					results[applyKey] = Number(total.toFixed(2));
					break;
				}
				case "COUNT":
					results[applyKey] = new Set(values).size;
					break;
			}
		}

		return results;
	}

	private mapColumns(row: any, columns: string[]): InsightResult {
		const res: InsightResult = {};
		for (const col of columns) {
			res[col] = this.extractValue(row, col);
		}
		return res;
	}

	// --- C2 TRANSFORMATIONS EXECUTION ENGINE ---
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

	// Sorting and order
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
				const valA = a[key];
				const valB = b[key];

				if (valA !== valB) {
					if (valA > valB) {
						return isDescending ? -1 : 1;
					}
					if (valA < valB) {
						return isDescending ? 1 : -1;
					}
				}
				// If valA === valB, loop continues cleanly to evaluate the next tie-breaker key!
			}
			return 0;
		});
	}

	// QUERY HANDLING END

	private async loadDatasetFromDisk(id: string): Promise<any[]> {
		try {
			const path = `./data/${id}.json`;
			const persisted: PersistedDataset = await fs.readJson(path);
			return persisted.rows;
		} catch (_err) {
			throw new InsightError(`Could not read dataset ${id} from disk`);
		}
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		await this.initializeDatasets();
		return Array.from(this.datasets.values());
	}
}
