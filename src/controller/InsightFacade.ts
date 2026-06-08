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
	private overallNumber = 1900;
	private resultLimit = 5000;

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
				// Dynamically infer the type based on the keys present inside saved items
				let inferredKind = InsightDatasetKind.Sections;
				if (data.length > 0 && data[0].hasOwnProperty("seats")) {
					inferredKind = InsightDatasetKind.Rooms;
				}
				return {
					id,
					numRows: data.length,
					kind: inferredKind
				};
			});

			try {
				const results = await Promise.all(readPromises);
				for (const res of results) {
					this.datasets.set(res.id, {
						id: res.id,
						kind: res.kind,
						numRows: res.numRows,
					});
				}
			} catch (_err) {
				// Silently skip corrupted disk file fragments
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
		if (!Array.isArray(filterList) || filterList.length === 0) {
			return false;
		}
		for (const filter of filterList) {
			if (!this.isFilterValid(filter)) {
				return false;
			}
		}
		return true;
	}

	private isMComparisonValid(mcomp: any): boolean {
		if (typeof mcomp !== "object" || mcomp === null || Array.isArray(mcomp)) {
			return false;
		}

		const keys = Object.keys(mcomp);
		if (keys.length !== 1) return false;

		const mkey = keys[0];
		if (typeof mcomp[mkey] !== "number") return false;

		return this.validateKey(mkey, "mfield");
	}

	private isSComparisonValid(scomp: any): boolean {
		if (typeof scomp !== "object" || scomp === null || Array.isArray(scomp)) return false;
		const keys = Object.keys(scomp);
		if (keys.length !== 1) return false;

		const skey = keys[0];
		const val = scomp[skey];
		if (typeof val !== "string") return false;

		if (val.includes("*")) {
			if (val.length === 2 && val === "**") return true;
			const inner = val.substring(1, val.length - 1);
			if (inner.includes("*")) return true;
		}

		return this.validateKey(skey, "sfield");
	}

	private isNegationValid(notVal: any): boolean {
		if (typeof notVal !== "object" || notVal === null || Array.isArray(notVal)) {
			return false;
		}
		return Object.keys(notVal).length === 1 && this.isFilterValid(notVal);
	}

	private isQueryValid(query: any): boolean {
		if (typeof query !== "object" || query === null || Array.isArray(query)) {
			return false;
		}
		const keys = Object.keys(query);
		if (keys.length !== 2 || !keys.includes("WHERE") || !keys.includes("OPTIONS")) {
			return false;
		}
		if (query.WHERE === undefined || query.OPTIONS === undefined) {
			return false;
		}
		if (Object.keys(query.WHERE).length > 0 && !this.isFilterValid(query.WHERE)) {
			return false;
		}
		return this.isOptionsValid(query.OPTIONS);
	}

	private isFilterValid(filter: any): boolean {
		if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
			return false;
		}
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
		if (typeof options !== "object" || options === null || Array.isArray(options)) {
			return false;
		}

		if (!Object.keys(options).includes("COLUMNS") || !Array.isArray(options.COLUMNS) || options.COLUMNS.length === 0) {
			return false;
		}

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

		const filteredResults = data.filter((row) => {
			if (Object.keys(queryObj.WHERE).length === 0) return true;
			return this.isRowValid(row, queryObj.WHERE);
		});

		if (filteredResults.length > this.resultLimit) {
			throw new ResultTooLargeError("Result too large (> 5000)");
		}

		const results: InsightResult[] = filteredResults.map((row) => {
			return this.transformToResult(row, queryObj.OPTIONS.COLUMNS);
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
		const field = queryKey.split("_")[1];

		let rowValue = row[this.fieldToKey[field]];
		if (field === "year") {
			rowValue = row.Section === "overall" ? this.overallNumber : parseInt(rowValue, 10);
		}
		return op(rowValue, targetValue);
	}

	private handleSComp(row: any, comparison: any): boolean {
		const queryKey = Object.keys(comparison)[0];
		const field = queryKey.split("_")[1];
		const inputString = comparison[queryKey];
		const rowValue = String(row[this.fieldToKey[field]]);

		let regString = inputString.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		regString = "^" + regString.replace(/\*/g, ".*") + "$";

		return new RegExp(regString).test(rowValue);
	}

	private transformToResult(row: any, columns: string[]): InsightResult {
		const result: InsightResult = {};

		for (const columnKey of columns) {
			const field = columnKey.split("_")[1];
			const dataKey = this.fieldToKey[field];

			let value = row[dataKey];
			if (field === "year") {
				value = row.Section === "overall" ? this.overallNumber : parseInt(value, 10);
			}
			if (field === "uuid" || field === "name" || field === "number") {
				value = String(value);
			}

			result[columnKey] = value;
		}

		return result;
	}

	private async loadDatasetFromDisk(id: string): Promise<any[]> {
		return await fs.readJson(`./data/${id}.json`);
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			throw new InsightError("Invalid id");
		}
		if (this.datasets.has(id)) {
			throw new InsightError("ID already exists");
		}
		if (content === null || content === undefined) {
			throw new InsightError("No content provided");
		}

		const zip = await JSZip.loadAsync(content, { base64: true });
		let rows: any[];

		if (kind === InsightDatasetKind.Sections) {
			rows = await this.parseSections(zip);
		} else if (kind === InsightDatasetKind.Rooms) {
			rows = await this.parseRooms(zip);
		} else {
			throw new InsightError("Error: Invalid dataset kind");
		}

		if (rows.length === 0) {
			throw new InsightError("Error: No valid rows found in dataset");
		}

		await fs.ensureDir("./data");
		await fs.writeJson(`./data/${id}.json`, rows);
		this.datasets.set(id, { id: id, kind: kind, numRows: rows.length });

		return Array.from(this.datasets.keys());
	}

	public async removeDataset(id: string): Promise<string> {
		await this.initializeDatasets();
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			throw new InsightError("Invalid id");
		}
		if (!this.datasets.has(id)) {
			throw new NotFoundError("id not found");
		}

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
		if (courseFiles.length === 0) {
			throw new InsightError("Error: No course files found in dataset");
		}

		const sections: any[] = [];
		await Promise.all(
			courseFiles.map(async (file) => {
				let course: any;
				try {
					const text = await file.async("text");
					course = JSON.parse(text);
				} catch {
					return;
				}

				if (course === null || course === undefined || !Array.isArray(course.result)) return;

				for (const row of course.result) {
					const parsed = parseSection(row);
					if (parsed !== null) sections.push(parsed);
				}
			})
		);

		return sections;
	}

	private async parseRooms(zip: JSZip): Promise<any[]> {
		const rooms: any[] = [];
		const indexFile = zip.file("index.htm");
		if (!indexFile) {
			throw new InsightError("Error: No index.htm file found in dataset");
		}

		const indexHtml = await indexFile.async("text");
		const buildings = parseBuildings(indexHtml);
		if (buildings.length === 0) return rooms;

		// Implementation of tree node table searches mapping building content arrays:
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

function parseBuildings(html: string): any[] {
	const buildings: any[] = [];
	const document = parse5.parse(html);
	const buildingListTable = findBuildingTable(document);
	if (!buildingListTable) return buildings;

	const tbody = findNode(buildingListTable, "tbody");
	if (!tbody) return buildings;
	const rows = tbody.childNodes.filter((node: any) => node.nodeName === "tr");

	for (const row of rows) {
		const building = getBuildingInfo(row);
		if (building) buildings.push(building);
	}
	return buildings;
}

function findBuildingTable(node: any): any {
	if (node.nodeName === "table" && tableHasClass(node, "views-field-title")) {
		return node;
	}
	if (node.childNodes) {
		for (const child of node.childNodes) {
			const result = findBuildingTable(child);
			if (result) return result;
		}
	}
	return null;
}

function tableHasClass(table: any, className: string): boolean {
	const tds = findAllNodes(table, "td");
	return tds.some((td: any) => hasClass(td, className));
}

function findAllNodes(node: any, name: string): any[] {
	const results: any[] = [];
	if (node.nodeName === name) results.push(node);
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

function findNode(node: any, name: string): any {
	if (node.nodeName === name) return node;
	if (node.childNodes) {
		for (const child of node.childNodes) {
			const result = findNode(child, name);
			if (result) return result;
		}
	}
	return null;
}

function getBuildingInfo(row: any): any | null {
	const cells = row.childNodes.filter((node: any) => node.nodeName === "td");
	let link: string | null = null, shortname: string | null = null, fullname: string | null = null, address: string | null = null;

	for (const cell of cells) {
		if (hasClass(cell, "views-field-title")) {
			const anchor = findNode(cell, "a");
			if (anchor) {
				link = getAttribute(anchor, "href");
				fullname = getTextContent(anchor).trim();
			}
		}
		if (hasClass(cell, "views-field-field-building-code")) {
			shortname = getTextContent(cell).trim();
		}
		if (hasClass(cell, "views-field-field-building-address")) {
			address = getTextContent(cell).trim();
		}
	}

	if (!link || !shortname || !fullname || !address) return null;
	return { link, shortname, fullname, address };
}

function getTextContent(node: any): string {
	if (node.nodeName === "#text") return node.value;
	if (node.childNodes) {
		return node.childNodes.map((child: any) => getTextContent(child)).join("");
	}
	return "";
}
