import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightResult,
	InsightError,
	NotFoundError,
	ResultTooLargeError,
} from "./IInsightFacade";
import JSZip from "jszip";
import * as fs from "fs-extra";
/**
 * This is the main programmatic entry point for the project.
 * Method documentation is in IInsightFacade
 *
 */
export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, InsightDataset>;
	private currentQueryId: string;
	// TESTING IF GIT DIDN'T BREAK
	constructor() {
		this.datasets = new Map<string, InsightDataset>();
		this.currentQueryId = "";
	}

	private async initializeDatasets(): Promise<void> {
		if (this.datasets.size > 0) {
			return;
		}

		if (await fs.pathExists("./data")) {
			const files = await fs.readdir("./data");
			const jsonFiles = files.filter((file) => file.endsWith(".json"));

			// 1. Create the "List of IOUs"
			const readPromises = jsonFiles.map(async (fileName) => {
				return fs.readJson(`./data/${fileName}`).then((data) => {
					return {
						id: fileName.replace(".json", ""),
						numRows: data.length,
					};
				});
			});
			// 2. Wait for all files to be read in parallel
			try {
				const results = await Promise.all(readPromises);

				// 3. Update the internal Map with the results
				for (const res of results) {
					this.datasets.set(res.id, {
						id: res.id,
						kind: InsightDatasetKind.Sections,
						numRows: res.numRows,
					});
				}
			} catch (_err) {
				// If one file fails or is corrupted, Promise.all might reject.
				// You can handle individual failures inside the .map if needed.
			}

			// for (const fileName of files) {
			// 	// fileName is "ubc.json"
			// 	if (fileName.endsWith(".json")) {
			// 		const id = fileName.replace(".json", "");
			// 		try {
			// 			const data = await fs.readJson(`./data/${fileName}`);
			// 			this.datasets.set(id, {
			// 				id: id,
			// 				kind: InsightDatasetKind.Sections,
			// 				numRows: data.length,
			// 			});
			// 		} catch (_err) {
			// 			// If a file is corrupted, we just skip it
			// 			continue;
			// 		}
			// 	}
			// }
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

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		// TODO: Remove this once you implement the methods!
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			return Promise.reject(new InsightError("Invalid id"));
		}
		if (this.datasets.has(id)) {
			return Promise.reject(new InsightError("ID already exists"));
		}
		if (kind !== "sections") {
			return Promise.reject(new InsightError("Invalid kind"));
		}

		const zip = new JSZip();
		let loadedZip;
		try {
			loadedZip = await zip.loadAsync(content, { base64: true });
		} catch (_err) {
			// console.error(err);
			// return Promise.reject(new InsightError("Data couldn't be unzipped!"));
			throw new InsightError("Data couldn't be unzipped!");
		}

		const coursesFolder = loadedZip.folder("courses");

		if (coursesFolder === null) {
			throw new InsightError("No valid sections found");
			// return Promise.reject(new InsightError("No 'courses' folder found in dataset"));
		}
		//
		// const promises: Array<Promise<string>> = [];
		//
		// coursesFolder.forEach((relativePath, file) => {
		// 	const fileReadPromise = file.async("string");
		// 	promises.push(fileReadPromise);
		// });
		//newZip.loadAsync(content).then((zip) => {});

		// const fileContents = await Promise.all(promises);

		// const sections: any[] = [];
		// for (const contentThing of fileContents) {
		// 	try {
		// 		const parsed = JSON.parse(contentThing);
		//
		// 		if (parsed.result && Array.isArray(parsed.result)) {
		// 			sections.push(...parsed.result);
		// 		}
		// 	} catch (err) {
		// 		continue;
		// 	}
		// }

		const sections = await this.processZipFiles(coursesFolder);

		if (sections.length === 0) {
			throw new InsightError("No valid sections found");
			//return Promise.reject(new InsightError("No valid sections found in dataset"));
		}

		await fs.ensureDir("./data");
		await fs.writeJson(`./data/${id}.json`, sections);

		// const newDataset: InsightDataset = {
		// 	id: id,
		// 	kind: kind,
		// 	numRows: sections.length,
		// };
		this.datasets.set(id, { id: id, kind: kind, numRows: sections.length });

		return Array.from(this.datasets.keys());
	}

	public async removeDataset(id: string): Promise<string> {
		// TODO: Remove this once you implement the methods!
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
		return Promise.resolve(id);
	}

	// private async retrieveDataset(id: string): Promise<any[]> {
	// const sections = await fs.readJson(`./data/${id}.json`);
	// 	return sections;
	// }

	private overallNumber = 1900;
	private resultLimit = 5000;

	// Mapping for internal data keys
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
	};

	private validateKey(key: any, type?: "mfield" | "sfield"): boolean {
		// 1. Must be a string
		if (typeof key !== "string") return false;

		// 2. Must have exactly one underscore
		const parts = key.split("_");
		if (parts.length !== 2) return false;

		const id = parts[0];
		const field = parts[1];

		// 3. ID Consistency: Use a helper property to track the ID of this query
		// In performQuery, you should reset this.currentQueryId = "";
		if (this.currentQueryId === "") {
			this.currentQueryId = id;
		} else if (this.currentQueryId !== id) {
			return false; // Multiple datasets referenced!
		}

		// 4. Dataset Existence: Check if you actually have this data
		if (!this.datasets.has(id)) return false;
		// 5. Field Check: Match against the EBNF lists
		const mfields = ["avg", "pass", "fail", "audit", "year"];
		const sfields = ["dept", "id", "instructor", "title", "uuid"];

		if (type === "mfield") return mfields.includes(field);
		if (type === "sfield") return sfields.includes(field);

		// If no specific type is required (like in COLUMNS), check both
		return mfields.includes(field) || sfields.includes(field);
	}

	private isLogicComparisonValid(filterList: any): boolean {
		// 1. Logic comparisons MUST be arrays
		if (!Array.isArray(filterList)) {
			return false;
		}

		// 2. The FILTER_LIST must have at least one FILTER
		if (filterList.length === 0) {
			return false;
		}

		// 3. Every item in the array must itself be a valid FILTER
		// This is where the RECURSION happens!
		for (const filter of filterList) {
			if (!this.isFilterValid(filter)) {
				return false;
			}
		}

		return true;
	}

	private isMComparisonValid(mcomp: any): boolean {
		if (typeof mcomp !== "object" || mcomp === null) {
			return false;
		}

		const keys = Object.keys(mcomp);
		if (keys.length !== 1) {
			return false;
		}

		const mkey = keys[0]; // e.g., "sections_avg"
		const val = mcomp[mkey];

		// Check 1: Is the value a number?
		if (typeof val !== "number") {
			return false;
		}

		// Check 2: Is the key format valid (id_field)?
		// Check 3: Is the field a valid mfield (avg, pass, etc.)?
		return this.validateKey(mkey, "mfield");
	}

	private isSComparisonValid(scomp: any): boolean {
		if (typeof scomp !== "object" || scomp === null) return false;
		const keys = Object.keys(scomp);
		if (keys.length !== 1) return false;

		const skey = keys[0];
		const val = scomp[skey];

		// IS requires a string value (and can include wildcards *)
		if (typeof val !== "string") return false;

		return this.validateKey(skey, "sfield");
	}

	private isNegationValid(notVal: any): boolean {
		if (typeof notVal !== "object" || notVal === null || Array.isArray(notVal)) {
			return false;
		}

		const keys = Object.keys(notVal);
		if (keys.length !== 1) {
			return false;
		}

		return this.isFilterValid(notVal);
	}

	private isSectionValid(section: any, filter: any): boolean {
		const key = Object.keys(filter)[0];
		const content = filter[key];

		switch (key) {
			case "AND":
				// Every filter in the list must be true
				return content.every((subFilter: any) => this.isSectionValid(section, subFilter));
			case "OR":
				// At least one filter in the list must be true
				return content.some((subFilter: any) => this.isSectionValid(section, subFilter));
			case "NOT":
				// Invert the result of the sub-filter
				return !this.isSectionValid(section, content);
			case "GT":
				return this.handleMComp(section, content, (a, b) => a > b);
			case "LT":
				return this.handleMComp(section, content, (a, b) => a < b);
			case "EQ":
				return this.handleMComp(section, content, (a, b) => a === b);
			case "IS":
				return this.handleSComp(section, content);
			default:
				// If WHERE is empty, the EBNF usually implies everything matches
				return true;
		}
	}

	private handleMComp(section: any, comparison: any, op: (a: number, b: number) => boolean): boolean {
		const queryKey = Object.keys(comparison)[0]; // e.g., "sections_avg"
		const targetValue = comparison[queryKey]; // e.g., 90
		const field = queryKey.split("_")[1]; // e.g., "avg"

		// Convert section "Year" to number if needed (some datasets use strings for years)
		let sectionValue = section[this.fieldToKey[field]];
		if (field === "year") {
			sectionValue = section.Section === "overall" ? this.overallNumber : parseInt(sectionValue, 10);
		}

		return op(sectionValue, targetValue);
	}

	private handleSComp(section: any, comparison: any): boolean {
		const queryKey = Object.keys(comparison)[0];
		const field = queryKey.split("_")[1];
		const inputString = comparison[queryKey];
		const sectionValue = String(section[this.fieldToKey[field]]);

		// Escape regex special characters except our asterisk
		let regString = inputString.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		// Replace '*' with '.*' (the regex equivalent)
		regString = "^" + regString.replace(/\*/g, ".*") + "$";

		const regex = new RegExp(regString);
		return regex.test(sectionValue);
	}

	private transformToResult(section: any, columns: string[]): InsightResult {
		const result: InsightResult = {};

		for (const columnKey of columns) {
			// columnKey is like "sections_avg"
			const field = columnKey.split("_")[1]; // "avg"
			const dataKey = this.fieldToKey[field]; // "Avg"

			let value = section[dataKey];

			// Apply the "overall" year logic if necessary
			if (field === "year") {
				value = section.Section === "overall" ? this.overallNumber : parseInt(value, 10);
			}

			// Ensure UUIDs are strings and other types match InsightResult
			if (field === "uuid") {
				value = String(value);
			}

			result[columnKey] = value;
		}

		return result;
	}

	private isQueryValid(query: any): boolean {
		const keys = Object.keys(query);
		if (keys.length !== 2 || !keys.includes("WHERE") || !keys.includes("OPTIONS")) {
			return false;
		}
		if (Object.keys(query.WHERE).length > 0) {
			if (!this.isFilterValid(query.WHERE)) {
				return false;
			}
		}
		if (!this.isOptionsValid(query.OPTIONS)) {
			return false;
		}

		return true;
	}

	private isFilterValid(filter: any): boolean {
		if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
			return false;
		}
		const keys = Object.keys(filter);

		if (keys.length !== 1) {
			return false;
		}

		const key = keys[0];

		if (key === "AND" || key === "OR") {
			return this.isLogicComparisonValid(filter[key]);
		} else if (key === "GT" || key === "LT" || key === "EQ") {
			return this.isMComparisonValid(filter[key]);
		} else if (key === "IS") {
			return this.isSComparisonValid(filter[key]);
		} else if (key === "NOT") {
			return this.isNegationValid(filter[key]);
		}

		return false;
	}

	private isOptionsValid(options: any): boolean {
		// 1. Basic check: is it an object?
		if (typeof options !== "object" || options === null || Array.isArray(options)) {
			return false;
		}

		// 2. Validate COLUMNS (Mandatory)
		if (!Object.keys(options).includes("COLUMNS") || !Array.isArray(options.COLUMNS) || options.COLUMNS.length === 0) {
			return false;
		}

		// 3. Check every key in COLUMNS
		for (const columnKey of options.COLUMNS) {
			if (!this.validateKey(columnKey)) {
				return false;
			}
		}

		// 4. Validate ORDER (Optional)
		if (Object.keys(options).includes("ORDER")) {
			const orderKey = options.ORDER;
			// ORDER must be a string and it MUST be one of the keys in COLUMNS
			if (typeof orderKey !== "string" || !options.COLUMNS.includes(orderKey)) {
				return false;
			}
		}

		// 5. Ensure no extra keys are in OPTIONS (like 'WHERE' inside 'OPTIONS')
		const validOptionsKeys = ["COLUMNS", "ORDER"];
		if (Object.keys(options).some((k) => !validOptionsKeys.includes(k))) {
			return false;
		}

		return true;
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		// TODO: Remove this once you implement the methods!
		this.currentQueryId = "";
		await this.initializeDatasets();
		if (typeof query !== "object" || query === null || Array.isArray(query)) {
			return Promise.reject(new InsightError("Query must be a non-null object"));
		}

		if (!this.isQueryValid(query)) {
			return Promise.reject(new InsightError("Invalid Query"));
		}
		// const data = await this.retrieveDataset(id);

		const queryObj = query as any;

		const data = await this.loadDatasetFromDisk(this.currentQueryId);

		const filteredResults = data.filter((section) => {
			if (Object.keys(queryObj.WHERE).length === 0) {
				return true;
			}
			return this.isSectionValid(section, queryObj.WHERE);
		});

		if (filteredResults.length > this.resultLimit) {
			throw new ResultTooLargeError("Result too large (> 5000)");
		}

		const results: InsightResult[] = filteredResults.map((section) => {
			return this.transformToResult(section, queryObj.OPTIONS.COLUMNS);
		});

		if (queryObj.OPTIONS.ORDER) {
			const orderKey = queryObj.OPTIONS.ORDER;
			results.sort((a, b) => {
				if (a[orderKey] > b[orderKey]) return 1;
				if (a[orderKey] < b[orderKey]) return -1;
				return 0;
			});
		}

		return results;
	}

	private async loadDatasetFromDisk(id: string): Promise<any[]> {
		try {
			const path = `./data/${id}.json`;
			// fs.readJson automatically parses the JSON string into a JS object/array
			return await fs.readJson(path);
		} catch (_err) {
			// This handles cases where the file might be missing or corrupted
			throw new InsightError(`Could not read dataset ${id} from disk`);
		}
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		// TODO: Remove this once you implement the methods!
		await this.initializeDatasets();
		return Array.from(this.datasets.values());
	}
}
