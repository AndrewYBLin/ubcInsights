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
import Decimal from "decimal.js";
import { queryHandler } from "./queryHandler";

// Internal structure used to save dataset state to disk along with its metadata
interface PersistedDataset {
	id: string;
	kind: InsightDatasetKind;
	data: any[];
}

export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, InsightDataset>;
	private currentQueryId: string;

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
				return fs
					.readJson(`./data/${fileName}`)
					.then((meta: PersistedDataset) => {
						return {
							id: meta.id,
							kind: meta.kind,
							numRows: meta.data.length,
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
					for (const sec of parsed.result) {
						if (isValidSection(sec)) {
							sections.push(sec);
						}
					}
				}
			} catch (_err) {
				continue;
			}
		}
		return sections;
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
		const persistencePayload: PersistedDataset = { id, kind, data: dataToStore };
		await fs.writeJson(`./data/${id}.json`, persistencePayload);

		this.datasets.set(id, { id, kind, numRows: dataToStore.length });
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
		return id;
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		await this.initializeDatasets();
		const handler = new queryHandler(this.datasets);
		return handler.performQuery(query);
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		await this.initializeDatasets();
		return Array.from(this.datasets.values());
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
			buildings.map(async (building: any) => {
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

		return rooms;
	}
}

function isValidSection(sec: any): boolean {
	return (
		sec !== null &&
		typeof sec === "object" &&
		sec.id !== undefined &&
		sec.Course !== undefined &&
		sec.Subject !== undefined &&
		sec.Avg !== undefined &&
		sec.Pass !== undefined &&
		sec.Fail !== undefined &&
		sec.Audit !== undefined &&
		sec.Year !== undefined &&
		sec.Professor !== undefined &&
		sec.Title !== undefined
	);
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
		if (!response.ok) return null;

		const data = (await response.json()) as {
			lat?: number;
			lon?: number;
			error?: string;
		};

		// geolocation fail
		if (data.error) return { lat: 0, lon: 0, error: data.error };

		if (typeof data.lat !== "number" || typeof data.lon !== "number") return null;

		return { lat: data.lat, lon: data.lon };
	} catch {
		return null;
	}
}
