import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightError,
	InsightResult,
	NotFoundError,
	ResultTooLargeError,
} from "./IInsightFacade";
import { Filter,
	AndFilter,
	OrFilter,
	NotFilter,
	MCompFilter,
	SCompFilter } from "./composite";
import JSZip from "jszip";
import * as fs from "fs-extra";
import * as parse5 from "parse5";
import Decimal from "decimal.js";
import { group } from "console";

// Internal structure used to save dataset state to disk along with its metadata
interface PersistedDataset {
	id: string;
	kind: InsightDatasetKind;
	rows: any[];
}
// did anything change reee
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

	private async processZipFiles(coursesFolder: JSZip): Promise<any[]> {
		const promises: Array<Promise<string>> = [];
		coursesFolder.forEach((relativePath, file) => {
			promises.push(file.async("string"));
		});

		const fileContents = await Promise.all(promises);
		const sections: any[] = [];

		for (const content of fileContents) {
			try {
				const parsed = JSON.parse(content);
				if (parsed.result && Array.isArray(parsed.result)) {
					sections.push(...parsed.result);
				}
			} catch (_err) {
				continue;
			}
		}
		return sections;
	}

	// CUSTOM ENDPOINT ADDED HERE
	public async getAverageGrade(id: string): Promise<object> {
		const datasets = await this.listDatasets();
		const dataset = datasets.find((d) => d.id === id);
		if (!dataset) {
			throw new NotFoundError(`Dataset ${id} not found`);
		}
		if (dataset.kind !== InsightDatasetKind.Sections) {
			throw new InsightError(`Dataset ${id} is not a sections dataset`);
		}

		const result = await this.performQuery({
			WHERE: {
				GT: { [`${id}_avg`]: 0 }
			},
			OPTIONS: {
				COLUMNS: [`${id}_dept`, "totalPass", "totalFail", "totalAudit", "weightedAvg"],
			},
			TRANSFORMATIONS: {
				GROUP: [`${id}_dept`],
				APPLY: [
					{ totalPass: { SUM: `${id}_pass` } },
					{ totalFail: { SUM: `${id}_fail` } },
					{ totalAudit: { SUM: `${id}_audit` } },
					{ weightedAvg: { AVG: `${id}_avg` } },
				]
			}
		});

		const totalSections = result.length;
		if (totalSections === 0) {
			throw new InsightError(`Dataset ${id} has no sections`);
		}

		let weightedSum = 0;
		let totalEnrollment = 0;

		for (const row of result) {
			const pass = Number(row["totalPass"]);
			const fail = Number(row["totalFail"]);
			const audit = Number(row["totalAudit"]);
			const avg = Number(row["weightedAvg"]);

			const enrollment = pass + fail + audit;
			weightedSum += avg * enrollment;
			totalEnrollment += enrollment;
		}

		const trueAvgGrade = totalEnrollment > 0
			? Math.round((weightedSum / totalEnrollment) * 100) / 100
			: 0;

		return {
			datasetId: id,
			averageGrade: trueAvgGrade,
		};
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
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

		let dataToStore: any[] = [];

		if (kind === InsightDatasetKind.Sections) {
			const zip = new JSZip();
			let loadedZip;
			try {
				loadedZip = await zip.loadAsync(content, { base64: true });
			} catch (_err) {
				throw new InsightError("Data couldn't be unzipped!");
			}
			const coursesFolder = loadedZip.folder("courses");
			if (coursesFolder === null) {
				throw new InsightError("No 'courses' folder found");
			}
			dataToStore = await this.processZipFiles(coursesFolder);
		} else if (kind === InsightDatasetKind.Rooms) {
			const zip = new JSZip();
			try {
				await zip.loadAsync(content, { base64: true });
			} catch (_err) {
				throw new InsightError("Data couldn't be unzipped!");
			}
			dataToStore = await this.parseRooms(zip);
		}

		if (dataToStore.length === 0) {
			throw new InsightError("No valid elements parsed inside archive");
		}

		await fs.ensureDir("./data");
		const persistencePayload: PersistedDataset = { id, kind, rows: dataToStore };
		// console.log("Sample row:", JSON.stringify(dataToStore[0], null, 2));
		await fs.writeJson(`./data/${id}.json`, persistencePayload);

		this.datasets.set(id, { id, kind, numRows: dataToStore.length });

		this.initialized = true;
		return Array.from(this.datasets.keys());
	}

	private async parseRooms(zip: JSZip): Promise<any[]> {
		const rooms: any[] = [];

		// get index.htm file
		const indexFile = zip.file("index.htm");
		if (!indexFile) {
			throw new InsightError("Error: No index.htm file found in dataset");
		}

		// get buildings
		const indexHtml = await indexFile.async("text");
		const buildings = parseBuildings(indexHtml);
		if (buildings.length === 0) return rooms;

		// asynchronously retrieve valid buildings and their fields
		await Promise.all(
			buildings.map(async (building) => {
				// get building geolocation
				const geo = await getGeoLocation(building.address);
				if (!geo || geo.error) return;

				const filePath = building.link.replace("./", "");
				const buildingFile = zip.file(filePath);
				if (!buildingFile) return;

				const buildingHtml = await buildingFile.async("text");
				const buildingRooms = parseRoomTable(buildingHtml, building, geo);
				rooms.push(...buildingRooms);
			})
		);
		console.log(`Total rooms parsed: ${rooms.length}`);
		return rooms;
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
		await this.initializeDatasets();
		this.currentQueryId = "";

		// 1. Validation
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
			const filteredData = Object.keys(where).length === 0
				? rawData
				: (() => {
					const filter = this.buildFilter(where);
					return rawData.filter((row: any) => filter.evaluate(row));
				})();
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


	private buildFilter(where: any): Filter {
    const key = Object.keys(where)[0];
    const content = where[key];

    switch (key) {
        case "AND":
            return new AndFilter(content.map((f: any) => this.buildFilter(f)));
        case "OR":
            return new OrFilter(content.map((f: any) => this.buildFilter(f)));
        case "NOT":
            return new NotFilter(this.buildFilter(content));
        case "GT":
            return new MCompFilter(
                Object.keys(content)[0], content[Object.keys(content)[0]],
                (a, b) => a > b, this.fieldToKey, this.datasets
            );
        case "LT":
            return new MCompFilter(
                Object.keys(content)[0], content[Object.keys(content)[0]],
                (a, b) => a < b, this.fieldToKey, this.datasets
            );
        case "EQ":
            return new MCompFilter(
                Object.keys(content)[0], content[Object.keys(content)[0]],
                (a, b) => a === b, this.fieldToKey, this.datasets
            );
        case "IS":
            return new SCompFilter(
                Object.keys(content)[0], content[Object.keys(content)[0]],
                this.fieldToKey
            );
        default:
            throw new InsightError(`Unknown filter key: ${key}`);
		}
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

		if (typeof query.WHERE !== "object" || query.WHERE === null || Array.isArray(query.WHERE)) return false;
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

	// can delete isRowValid, handleMComp, handleSComp

	// Where filter handling
	// private isRowValid(row: any, filter: any): boolean {
	// 	const key = Object.keys(filter)[0];
	// 	const content = filter[key];

	// 	switch (key) {
	// 		case "AND":
	// 			return content.every((subFilter: any) => this.isRowValid(row, subFilter));
	// 		case "OR":
	// 			return content.some((subFilter: any) => this.isRowValid(row, subFilter));
	// 		case "NOT":
	// 			return !this.isRowValid(row, content);
	// 		case "GT":
	// 			return this.handleMComp(row, content, (a, b) => a > b);
	// 		case "LT":
	// 			return this.handleMComp(row, content, (a, b) => a < b);
	// 		case "EQ":
	// 			return this.handleMComp(row, content, (a, b) => a === b);
	// 		case "IS":
	// 			return this.handleSComp(row, content);
	// 		default:
	// 			return true;
	// 	}
	// }

	// private handleMComp(row: any, comparison: any, op: (a: number, b: number) => boolean): boolean {
	// 	const queryKey = Object.keys(comparison)[0];
	// 	const targetValue = comparison[queryKey];
	// 	const parts = queryKey.split("_");
	// 	const id = parts[0];
	// 	const field = parts[1];

	// 	// 1. Get the dataset kind dynamically from your storage map
	// 	const kind = this.datasets.get(id)!.kind;

	// 	// 2. Fetch the raw value (use your existing mapping dictionary)
	// 	let sectionValue = row[this.fieldToKey[field]];

	// 	// 3. Apply dataset-specific logic only when necessary
	// 	if (kind === InsightDatasetKind.Sections && field === "year") {
	// 		sectionValue = row.Section === "overall" ? 1900 : parseInt(sectionValue, 10);
	// 	}

	// 	return op(Number(sectionValue), targetValue);
	// }

	// private handleSComp(section: any, comparison: any): boolean {
	// 	const queryKey = Object.keys(comparison)[0];
	// 	const field = queryKey.split("_")[1];
	// 	const inputString = comparison[queryKey];
	// 	const sectionValue = String(section[this.fieldToKey[field]]);

	// 	let regString = inputString.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	// 	regString = "^" + regString.replace(/\*/g, ".*") + "$";
	// 	return new RegExp(regString).test(sectionValue);
	// }

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
					results[applyKey] = values.reduce((a, b) => (a > b ? a : b));
					break;
				case "MIN":
					results[applyKey] = values.reduce((a, b) => (a < b ? a : b));
					break;
				case "AVG": {
					const total = values.reduce((sum, v) => sum.add(new Decimal(v)), new Decimal(0));
					const avg = total.toNumber() / bucketRows.length;
					results[applyKey] = Number(avg.toFixed(2));
					break;
				}
				case "SUM": {
					const sumTotal = values.reduce((a, b) => a + b, 0);
					results[applyKey] = Number(sumTotal.toFixed(2));
					break;
				}
				case "COUNT":
					results[applyKey] = new Set(
						bucketRows.map((r) => this.extractValue(r, targetKey))
					).size;
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
		const result = Array.from(this.datasets.values());

		return result;
	}
}

// helper to parse building files
function parseBuildings(html: string): any[] {
	const buildings: any[] = [];

	const document = parse5.parse(html);

	// find the valid building list table
	const buildingListTable = findBuildingTable(document);
	if (!buildingListTable) return buildings;

	// get tr row elements from tbody
	const tbody = findNode(buildingListTable, "tbody");
	if (!tbody) return buildings;
	const rows = tbody.childNodes.filter((node: any) => node.nodeName === "tr");

	// extract building info from each row
	for (const row of rows) {
		const building = getBuildingInfo(row);
		if (building) buildings.push(building);
	}

	return buildings;
}

// Building table helpers start
function findBuildingTable(node: any): any {
	if (node.nodeName === "table") {
		if (tableHasClass(node, "views-field-title")) {
			return node;
		}
	}

	// recursively search child nodes
	if (node.childNodes) {
		for (const child of node.childNodes) {
			const result = findBuildingTable(child);
			if (result) return result;
		}
	}

	// not found
	return null;
}

function tableHasClass(table: any, className: string): boolean {
	const tds = findAllNodes(table, "td");

	// check if any td has the class
	return tds.some((td: any) => hasClass(td, className));
}

function findAllNodes(node: any, name: string): any[] {
	const results: any[] = [];

	// add matching nodes
	if (node.nodeName === name) {
		results.push(node);
	}

	// recursively search child nodes
	if (node.childNodes) {
		for (const child of node.childNodes) {
			results.push(...findAllNodes(child, name));
		}
	}

	return results;
}

function hasClass(node: any, className: string): boolean {
	const classAttr = getAttribute(node, "class");
	if (!classAttr) return false;
	return classAttr.split(" ").includes(className);
}

function getAttribute(node: any, attrName: string): string | null {
	if (!node.attrs) return null;
	const attr = node.attrs.find((a: any) => a.name === attrName);
	return attr ? attr.value : null;
}
//  Building table helpers end

function findNode(node: any, name: string): any {
	if (node.nodeName === name) return node;

	// recursively search child nodes
	if (node.childNodes) {
		for (const child of node.childNodes) {
			const result = findNode(child, name);
			if (result) return result;
		}
	}

	// not found
	return null;
}

// Building info helpers start
function getBuildingInfo(row: any): any | null {
	const cells = row.childNodes.filter((node: any) => node.nodeName === "td");

	let link: string | null = null;
	let shortname: string | null = null;
	let fullname: string | null = null;
	let address: string | null = null;

	for (const cell of cells) {
		// build link and fullname
		if (hasClass(cell, "views-field-title")) {
			const anchor = findNode(cell, "a");
			if (anchor) {
				link = getAttribute(anchor, "href");
				fullname = getTextContent(anchor).trim();
			}
		}

		// build shortname
		if (hasClass(cell, "views-field-field-building-code")) {
			shortname = getTextContent(cell).trim();
		}

		// build address
		if (hasClass(cell, "views-field-field-building-address")) {
			address = getTextContent(cell).trim();
		}
	}

	// reject if any field is missing
	if (!link || !shortname || !fullname || !address) return null;

	return {
		link,
		shortname,
		fullname,
		address,
	};
}

function getTextContent(node: any): string {
	// base case: text node contains actual text
	if (node.nodeName === "#text") return node.value;

	// recursively get text from all children
	if (node.childNodes) {
		return node.childNodes.map((child: any) => getTextContent(child)).join("");
	}

	return "";
}
// Building info helpers end

// Room table helpers start
function parseRoomTable(
	buildingHtml: string,
	building: { fullname: string; shortname: string; address: string },
	geo: { lat: number; lon: number }
): any[] {
	const document = parse5.parse(buildingHtml);
	const rooms: any[] = [];

	const roomTable = findRoomTable(document);
	if (!roomTable) return rooms;

	const tbody = findNode(roomTable, "tbody");
	if (!tbody) return rooms;

	const rows = tbody.childNodes.filter((n: any) => n.nodeName === "tr");

	for (const row of rows) {
		const room = getRoomInfo(row, building, geo);
		if (room) rooms.push(room);
	}

	return rooms;
}

function findRoomTable(node: any): any {
	if (node.nodeName === "table") {
		const tds = findAllNodes(node, "td");
		const hasRoomNumber = tds.some((td: any) => hasClass(td, "views-field-field-room-number"));
		if (hasRoomNumber) return node;
	}

	if (node.childNodes) {
		for (const child of node.childNodes) {
			const result = findRoomTable(child);
			if (result) return result;
		}
	}

	return null;
}

function getRoomInfo(
	row: any,
	building: { fullname: string; shortname: string; address: string },
	geo: { lat: number; lon: number }
): any {
	const cells = row.childNodes.filter((n: any) => n.nodeName == "td");
	if (cells.length === 0) return null;

	// room fields
	let number: string | null = null;
	let href: string | null = null;
	let seats: number | null = null;
	let type: string | null = null;
	let furniture: string | null = null;

	for (const cell of cells) {
		if (hasClass(cell, "views-field-field-room-number")) {
			const anchor = findNode(cell, "a");
			number = anchor ? getTextContent(anchor).trim() : getTextContent(cell).trim();
			if (anchor && !href) href = getAttribute(anchor, "href");
		}

		if (hasClass(cell, "views-field-field-room-capacity")) {
			const raw = getTextContent(cell).trim();
			seats = parseInt(raw, 10);
		}

		if (hasClass(cell, "views-field-field-room-furniture")) {
			furniture = getTextContent(cell).trim();
		}

		if (hasClass(cell, "views-field-field-room-type")) {
			type = getTextContent(cell).trim();
		}

		if (hasClass(cell, "views-field-nothing")) {
			const anchor = findNode(cell, "a");
			if (anchor) href = getAttribute(anchor, "href");
		}
	}

	// reject if any field is missing
	if (!number || seats === null || isNaN(seats) || !furniture || !type || !href) {
		return null;
	}

	return {
		fullname: building.fullname,
		shortname: building.shortname,
		number,
		name: `${building.shortname}_${number}`,
		address: building.address,
		lat: geo.lat,
		lon: geo.lon,
		seats,
		type,
		furniture,
		href,
	};
}
// Room table helpers end

// Geolocation
async function getGeoLocation(
	address: string
): Promise<{ lat: number; lon: number; error?: string | undefined } | null> {
	try {
		const encodedAddress = encodeURIComponent(address);
		const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team059/${encodedAddress}`;

		const response = await fetch(url);
		// console.log(`Geo [${response.status}] ${address}`);
		if (!response.ok) return null;

		const data = (await response.json()) as {
			lat?: number;
			lon?: number;
			error?: string;
		};

		// geolocation fail
		if (data.error) return null;

		if (typeof data.lat !== "number" || typeof data.lon !== "number") return null;

		return { lat: data.lat, lon: data.lon };
	} catch(e) {
		// console.log(`Geo ERROR for ${address}:`, e);
		return null;
	}
}
