import {
	IInsightFacade,
	InsightDataset,
	InsightDatasetKind,
	InsightResult,
	InsightError,
	NotFoundError,
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
	// mann
	constructor() {
		this.datasets = new Map<string, InsightDataset>();
		this.currentQueryId = "";
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
		} // else if (key === "NOT") {
		// 	return this.isNegationValid(filter[key]);
		// }
		else if (key === "NOT") {
			return this.isFilterValid(filter[key]); // NOT just wraps another filter
		}

		return false;
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
		if (typeof mcomp !== "object" || mcomp === null) return false;

		const keys = Object.keys(mcomp);
		if (keys.length !== 1) return false;

		const mkey = keys[0]; // e.g., "sections_avg"
		const val = mcomp[mkey];

		// Check 1: Is the value a number?
		if (typeof val !== "number") return false;

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

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		// TODO: Remove this once you implement the methods!
		this.currentQueryId = "";
		if (typeof query !== "object" || query === null || Array.isArray(query)) {
			return Promise.reject(new InsightError("Query must be a non-null object"));
		}

		if (!this.isQueryValid(query)) {
			return Promise.reject(new InsightError("Invalid Query"));
		}
		// const data = await this.retrieveDataset(id);

		throw new Error(`InsightFacadeImpl::performQuery() is unimplemented! - query=${query};`);
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		// TODO: Remove this once you implement the methods!
		const datasetList: InsightDataset[] = Array.from(this.datasets.values());
		return datasetList;
	}
}
