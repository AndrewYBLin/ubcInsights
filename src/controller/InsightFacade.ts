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
import * as parse5 from "parse5";

export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, InsightDataset>;
	private currentQueryId: string;

	private sectionsMFields = ["avg", "pass", "fail", "audit", "year"];
	private sectionsSFields = ["dept", "id", "instructor", "title", "uuid"];
	private roomsMFields = ["lat", "lon", "seats"];
	private roomsSFields = ["fullname", "shortname", "number", "name", "address", "type", "furniture", "href"];

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
		// Rooms mappings (add your exact fields here when integrating your rooms data)
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
		if (this.datasets.size > 0) {
			return;
		}
		if (await fs.pathExists("./data")) {
			const files = await fs.readdir("./data");
			const jsonFiles = files.filter((file) => file.endsWith(".json"));
			const readPromises = jsonFiles.map(async (fileName) => {
				const data = await fs.readJson(`./data/${fileName}`);
				const id = fileName.replace(".json", "");
				// For C2, your addDataset should cache or infer the kind. Defaulting safely to sections for now:
				return { id, numRows: data.length, kind: InsightDatasetKind.Sections };
			});
			try {
				const results = await Promise.all(readPromises);
				for (const res of results) {
					this.datasets.set(res.id, { id: res.id, kind: res.kind, numRows: res.numRows });
				}
			} catch (_err) {
				// Keep moving silently if a directory file is malformed
			}
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
		const kind = this.datasets.get(id)?.kind;

		if (kind === InsightDatasetKind.Sections) {
			if (type === "mfield") return this.sectionsMFields.includes(field);
			if (type === "sfield") return this.sectionsSFields.includes(field);
			return this.sectionsMFields.includes(field) || this.sectionsSFields.includes(field);
		} else {
			if (type === "mfield") return this.roomsMFields.includes(field);
			if (type === "sfield") return this.roomsSFields.includes(field);
			return this.roomsMFields.includes(field) || this.roomsSFields.includes(field);
		}
	}

	private isLogicComparisonValid(filterList: any): boolean {
		if (!Array.isArray(filterList) || filterList.length === 0) return false;
		for (const filter of filterList) {
			if (!this.isFilterValid(filter)) return false;
		}
		return true;
	}

	private isMComparisonValid(mcomp: any): boolean {
		if (typeof mcomp !== "object" || mcomp === null || Array.isArray(mcomp)) return false;
		const keys = Object.keys(mcomp);
		if (keys.length !== 1) return false;
		return typeof mcomp[keys[0]] === "number" && this.validateKey(keys[0], "mfield");
	}

	private isSComparisonValid(scomp: any): boolean {
		if (typeof scomp !== "object" || scomp === null || Array.isArray(scomp)) return false;
		const keys = Object.keys(scomp);
		if (keys.length !== 1) return false;
		const val = scomp[keys[0]];
		if (typeof val !== "string") return false;

		// Wildcard rules check
		if (val.includes("*")) {
			const inner = val.substring(1, val.length - 1);
			if (inner.includes("*") || (val.length === 2 && val === "**")) return true;
		}
		return this.validateKey(keys[0], "sfield");
	}

	private isNegationValid(notVal: any): boolean {
		if (typeof notVal !== "object" || notVal === null || Array.isArray(notVal)) return false;
		return Object.keys(notVal).length === 1 && this.isFilterValid(notVal);
	}

	private isQueryValid(query: any): boolean {
		if (typeof query !== "object" || query === null || Array.isArray(query)) return false;
		const keys = Object.keys(query);
		if (keys.length !== 2 || !keys.includes("WHERE") || !keys.includes("OPTIONS")) return false;
		if (query.WHERE === undefined || query.OPTIONS === undefined) return false;

		if (Object.keys(query.WHERE).length > 0 && !this.isFilterValid(query.WHERE)) return false;
		return this.isOptionsValid(query.OPTIONS);
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

	private isOptionsValid(options: any): boolean {
		if (typeof options !== "object" || options === null || Array.isArray(options)) return false;
		if (!Object.keys(options).includes("COLUMNS") || !Array.isArray(options.COLUMNS) || options.COLUMNS.length === 0) return false;

		for (const columnKey of options.COLUMNS) {
			if (!this.validateKey(columnKey)) return false;
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
					if (!this.validateKey(k) || !options.COLUMNS.includes(k)) return false;
				}
			} else {
				return false;
			}
		}

		const validOptionsKeys = ["COLUMNS", "ORDER"];
		return !Object.keys(options).some((k) => !validOptionsKeys.includes(k));
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		this.currentQueryId = "";
		await this.initializeDatasets();

		if (!this.isQueryValid(query)) {
			return Promise.reject(new InsightError("Invalid Query"));
		}

		const queryObj = query as any;
		const data = await this.loadDatasetFromDisk(this.currentQueryId);

		const filteredResults = data.filter((section) => {
			if (Object.keys(queryObj.WHERE).length === 0) return true;
			return this.isSectionValid(section, queryObj.WHERE);
		});

		if (filteredResults.length > 5000) {
			throw new ResultTooLargeError("Result too large (> 5000)");
		}

		const results: InsightResult[] = filteredResults.map((section) => {
			return this.transformToResult(section, queryObj.OPTIONS.COLUMNS);
		});

		if (queryObj.OPTIONS.ORDER) {
			const order = queryObj.OPTIONS.ORDER;
			const isObjectOrder = typeof order === "object";
			const direction = isObjectOrder ? order.dir : "UP";
			const sortKeys: string[] = isObjectOrder ? order.keys : [order];

			results.sort((a, b) => {
				for (const key of sortKeys) {
					if (a[key] > b[key]) return direction === "UP" ? 1 : -1;
					if (a[key] < b[key]) return direction === "UP" ? -1 : 1;
				}
				return 0;
			});
		}
		return results;
	}

	// Keep old sections helper operations identical
	private isSectionValid(section: any, filter: any): boolean {
		const key = Object.keys(filter)[0];
		const content = filter[key];
		switch (key) {
			case "AND": return content.every((subFilter: any) => this.isSectionValid(section, subFilter));
			case "OR": return content.some((subFilter: any) => this.isSectionValid(section, subFilter));
			case "NOT": return !this.isSectionValid(section, content);
			case "GT": return this.handleMComp(section, content, (a, b) => a > b);
			case "LT": return this.handleMComp(section, content, (a, b) => a < b);
			case "EQ": return this.handleMComp(section, content, (a, b) => a === b);
			case "IS": return this.handleSComp(section, content);
			default: return true;
		}
	}

	private handleMComp(section: any, comparison: any, op: (a: number, b: number) => boolean): boolean {
		const queryKey = Object.keys(comparison)[0];
		const targetValue = comparison[queryKey];
		const field = queryKey.split("_")[1];
		let sectionValue = section[this.fieldToKey[field]];
		if (field === "year") {
			sectionValue = section.Section === "overall" ? 1900 : parseInt(sectionValue, 10);
		}
		return op(sectionValue, targetValue);
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

	private transformToResult(section: any, columns: string[]): InsightResult {
		const result: InsightResult = {};
		for (const columnKey of columns) {
			const field = columnKey.split("_")[1];
			const dataKey = this.fieldToKey[field];
			let value = section[dataKey];
			if (field === "year") {
				value = section.Section === "overall" ? 1900 : parseInt(value, 10);
			}
			if (field === "uuid") value = String(value);
			result[columnKey] = value;
		}
		return result;
	}

	private async loadDatasetFromDisk(id: string): Promise<any[]> {
		return await fs.readJson(`./data/${id}.json`);
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) throw new InsightError("Invalid id");
		if (this.datasets.has(id)) throw new InsightError("ID already exists");
		if (!content) throw new InsightError("No content provided");

		const zip = await JSZip.loadAsync(content, { base64: true });
		let rows: any[];
		if (kind === InsightDatasetKind.Sections) rows = await this.parseSections(zip);
		else if (kind === InsightDatasetKind.Rooms) rows = await this.parseRooms(zip);
		else throw new InsightError("Invalid dataset kind");

		if (rows.length === 0) throw new InsightError("No valid rows found");
		await fs.ensureDir("./data");
		await fs.writeJson(`./data/${id}.json`, rows);
		this.datasets.set(id, { id, kind, numRows: rows.length });
		return Array.from(this.datasets.keys());
	}

	public async removeDataset(id: string): Promise<string> {
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) throw new InsightError("Invalid id");
		if (!this.datasets.has(id)) throw new NotFoundError("id not found");
		this.datasets.delete(id);
		await fs.remove(`./data/${id}.json`);
		return id;
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		await this.initializeDatasets();
		return Array.from(this.datasets.values());
	}

	private async parseSections(zip: JSZip): Promise<any[]> {
		const courseFiles = Object.values(zip.files).filter((file) => file.name.startsWith("courses/") && !file.dir);
		if (courseFiles.length === 0) throw new InsightError("No course files found");
		const sections: any[] = [];
		await Promise.all(
			courseFiles.map(async (file) => {
				try {
					const text = await file.async("text");
					const course = JSON.parse(text);
					if (course && Array.isArray(course.result)) {
						for (const row of course.result) {
							const parsed = parseSection(row);
							if (parsed) sections.push(parsed);
						}
					}
				} catch {
					// Skip malformed text entries cleanly
				}
			})
		);
		return sections;
	}

	private async parseRooms(zip: JSZip): Promise<any[]> {
		const rooms: any[] = [];
		const indexFile = zip.file("index.htm");
		if (!indexFile) throw new InsightError("No index.htm file found");
		return rooms;
	}
}

function parseSection(row: any): any | null {
	const hasRequiredFields =
		row.id !== undefined && row.Course !== undefined && row.Title !== undefined &&
		row.Professor !== undefined && row.Subject !== undefined && row.Year !== undefined &&
		row.Avg !== undefined && row.Pass !== undefined && row.Fail !== undefined && row.Audit !== undefined;
	if (!hasRequiredFields) return null;

	return {
		uuid: String(row.id),
		id: String(row.Course),
		title: String(row.Title),
		instructor: String(row.Professor),
		dept: String(row.Subject),
		year: row.Section === "overall" ? 1900 : Number(row.Year),
		avg: Number(row.Avg),
		pass: Number(row.Pass),
		fail: Number(row.Fail),
		audit: Number(row.Audit),
	};
}
