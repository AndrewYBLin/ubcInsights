
import * as parse5 from "parse5";
import * as http from "http";
// did something weird happen heree

export interface ParsedBuilding {
	shortname: string;
	fullname: string;
	address: string;
	pathLink: string;
}

export interface GeoResponse {
	lat?: number;
	lon?: number;
	error?: string;
}

export class RoomParser {
	public parseIndex(indexHtmlContent: string): ParsedBuilding[] {
		const parsedDocument = parse5.parse(indexHtmlContent);
		const discoveredBuildings: ParsedBuilding[] = [];

		// Note the use of "this." when calling class methods!
		const tables = this.findNodes(parsedDocument, (node) => {
			const className = this.getAttributeValue(node, "class") || "";
			return node.tagName === "table" && className.includes("views-table");
		});

		if (tables.length === 0) {
			return discoveredBuildings;
		}

		const mainTable = tables[0];
		const tableRows = this.findNodes(mainTable, (node) => node.tagName === "tr");

		for (const row of tableRows) {
			const cells = this.findNodes(row, (node) => node.tagName === "td");
			if (cells.length === 0) {
				continue;
			}

			let shortname = "";
			let fullname = "";
			let address = "";
			let pathLink = "";

			for (const cell of cells) {
				const cellClass = this.getAttributeValue(cell, "class") || "";

				if (cellClass.includes("views-field-field-building-code")) {
					shortname = this.getElementText(cell);
				} else if (cellClass.includes("views-field-title")) {
					fullname = this.getElementText(cell);
					const anchorTags = this.findNodes(cell, (node) => node.tagName === "a");
					if (anchorTags.length > 0) {
						pathLink = this.getAttributeValue(anchorTags[0], "href") || "";
					}
				} else if (cellClass.includes("views-field-field-building-address")) {
					address = this.getElementText(cell);
				}
			}

			if (shortname && fullname && address && pathLink) {
				discoveredBuildings.push({ shortname, fullname, address, pathLink });
			}
		}

		// Resolves TS2355: Enforces a guarantee that a value is always returned
		return discoveredBuildings;
	}

	// converted from pure function to a regular private method structure
	private findNodes(node: any, condition: (n: any) => boolean): any[] {
		let results: any[] = [];
		if (!node) {
			return results;
		}
		if (condition(node)) {
			results.push(node);
		}
		if (node.childNodes && Array.isArray(node.childNodes)) {
			for (const child of node.childNodes) {
				results = results.concat(this.findNodes(child, condition));
			}
		}
		return results;
	}

	private getAttributeValue(node: any, attrName: string): string | null {
		if (!node.attrs || !Array.isArray(node.attrs)) {
			return null;
		}
		const found = node.attrs.find((attr: any) => attr.name === attrName);
		return found ? found.value : null;
	}

	private getElementText(node: any): string {
		if (!node) {
			return "";
		}
		if (node.nodeName === "#text") {
			return node.value.trim();
		}
		let text = "";
		if (node.childNodes) {
			for (const child of node.childNodes) {
				text += this.getElementText(child);
			}
		}
		return text.trim();
	}

	/**
	 * Processes an individual building's HTML payload and maps all rooms.
	 */
	public parseBuildingRooms(htmlContent: string, buildingMeta: any): any[] {
		const parsedDocument = parse5.parse(htmlContent);
		const discoveredRooms: any[] = [];

		// Find the rooms table block inside the specific building file
		const tables = this.findNodes(parsedDocument, (node) => {
			const className = this.getAttributeValue(node, "class") || "";
			return node.tagName === "table" && className.includes("views-table");
		});

		// If a building doesn't contain any classrooms listed, return an empty tracking array gracefully
		if (tables.length === 0) {
			return discoveredRooms;
		}

		const roomsTable = tables[0];
		const tableRows = this.findNodes(roomsTable, (node) => node.tagName === "tr");

		for (const row of tableRows) {
			const cells = this.findNodes(row, (node) => node.tagName === "td");
			if (cells.length === 0) {
				continue; // Skip table header rows safely
			}

			let number = "";
			let seats = 0;
			let furniture = "";
			let type = "";
			let href = "";

			for (const cell of cells) {
				const cellClass = this.getAttributeValue(cell, "class") || "";

				if (cellClass.includes("views-field-field-room-number")) {
					number = this.getElementText(cell);
					const anchorTags = this.findNodes(cell, (node) => node.tagName === "a");
					if (anchorTags.length > 0) {
						href = this.getAttributeValue(anchorTags[0], "href") || "";
					}
				} else if (cellClass.includes("views-field-field-room-capacity")) {
					seats = parseInt(this.getElementText(cell), 10) || 0;
				} else if (cellClass.includes("views-field-field-room-furniture")) {
					furniture = this.getElementText(cell);
				} else if (cellClass.includes("views-field-field-room-type")) {
					type = this.getElementText(cell);
				}
			}

			if (number && href && furniture && type && seats > 0) {
				// CRITICAL CHECKPOINT 2 CONSTRAINTS:
				// 1. Generate unique room name signature string format: shortname + "_" + number
				const name = `${buildingMeta.shortname}_${number}`;

				discoveredRooms.push({
					fullname: buildingMeta.fullname,
					shortname: buildingMeta.shortname,
					number: number,
					name: name,
					address: buildingMeta.address,
					lat: buildingMeta.lat,
					lon: buildingMeta.lon,
					seats: seats,
					type: type,
					furniture: furniture,
					href: href,
				});
			}
		}

		return discoveredRooms;
	}

	/**
	 * Hits the university web service asynchronously to retrieve lat/lon coordinates.
	 */
	public getCoordinates(address: string): Promise<GeoResponse> {
		const teamNum = "059"; // Replace with your explicit 3-digit CPSC 310 team number
		const encodedAddress = encodeURIComponent(address);
		const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team${teamNum}/${encodedAddress}`;

		return new Promise((resolve, reject) => {
			http
				.get(url, (res) => {
					let rawData = "";
					res.on("data", (chunk) => {
						rawData += chunk;
					});
					res.on("end", () => {
						try {
							const parsedData: GeoResponse = JSON.parse(rawData);
							resolve(parsedData);
						} catch (e) {
							resolve({ error: "Failed to parse coordinate response payload" });
						}
					});
				})
				.on("error", (err) => {
					resolve({ error: err.message });
				});
		});
	}
}
=======
import * as parse5 from "parse5";
import * as http from "http";

export interface ParsedBuilding {
	shortname: string;
	fullname: string;
	address: string;
	pathLink: string;
}

export interface GeoResponse {
	lat?: number;
	lon?: number;
	error?: string;
}

export class RoomParser {
	public parseIndex(indexHtmlContent: string): ParsedBuilding[] {
		const parsedDocument = parse5.parse(indexHtmlContent);
		const discoveredBuildings: ParsedBuilding[] = [];

		// Note the use of "this." when calling class methods!
		const tables = this.findNodes(parsedDocument, (node) => {
			const className = this.getAttributeValue(node, "class") || "";
			return node.tagName === "table" && className.includes("views-table");
		});

		if (tables.length === 0) {
			return discoveredBuildings;
		}

		const mainTable = tables[0];
		const tableRows = this.findNodes(mainTable, (node) => node.tagName === "tr");

		for (const row of tableRows) {
			const cells = this.findNodes(row, (node) => node.tagName === "td");
			if (cells.length === 0) {
				continue;
			}

			let shortname = "";
			let fullname = "";
			let address = "";
			let pathLink = "";

			for (const cell of cells) {
				const cellClass = this.getAttributeValue(cell, "class") || "";

				if (cellClass.includes("views-field-field-building-code")) {
					shortname = this.getElementText(cell);
				} else if (cellClass.includes("views-field-title")) {
					fullname = this.getElementText(cell);
					const anchorTags = this.findNodes(cell, (node) => node.tagName === "a");
					if (anchorTags.length > 0) {
						pathLink = this.getAttributeValue(anchorTags[0], "href") || "";
					}
				} else if (cellClass.includes("views-field-field-building-address")) {
					address = this.getElementText(cell);
				}
			}

			if (shortname && fullname && address && pathLink) {
				discoveredBuildings.push({ shortname, fullname, address, pathLink });
			}
		}

		// Resolves TS2355: Enforces a guarantee that a value is always returned
		return discoveredBuildings;
	}

	// converted from pure function to a regular private method structure
	private findNodes(node: any, condition: (n: any) => boolean): any[] {
		let results: any[] = [];
		if (!node) {
			return results;
		}
		if (condition(node)) {
			results.push(node);
		}
		if (node.childNodes && Array.isArray(node.childNodes)) {
			for (const child of node.childNodes) {
				results = results.concat(this.findNodes(child, condition));
			}
		}
		return results;
	}

	private getAttributeValue(node: any, attrName: string): string | null {
		if (!node.attrs || !Array.isArray(node.attrs)) {
			return null;
		}
		const found = node.attrs.find((attr: any) => attr.name === attrName);
		return found ? found.value : null;
	}

	private getElementText(node: any): string {
		if (!node) {
			return "";
		}
		if (node.nodeName === "#text") {
			return node.value.trim();
		}
		let text = "";
		if (node.childNodes) {
			for (const child of node.childNodes) {
				text += this.getElementText(child);
			}
		}
		return text.trim();
	}

	/**
	 * Processes an individual building's HTML payload and maps all rooms.
	 */
	public parseBuildingRooms(htmlContent: string, buildingMeta: any): any[] {
		const parsedDocument = parse5.parse(htmlContent);
		const discoveredRooms: any[] = [];

		// Find the rooms table block inside the specific building file
		const tables = this.findNodes(parsedDocument, (node) => {
			const className = this.getAttributeValue(node, "class") || "";
			return node.tagName === "table" && className.includes("views-table");
		});

		// If a building doesn't contain any classrooms listed, return an empty tracking array gracefully
		if (tables.length === 0) {
			return discoveredRooms;
		}

		const roomsTable = tables[0];
		const tableRows = this.findNodes(roomsTable, (node) => node.tagName === "tr");

		for (const row of tableRows) {
			const cells = this.findNodes(row, (node) => node.tagName === "td");
			if (cells.length === 0) {
				continue; // Skip table header rows safely
			}

			let number = "";
			let seats = 0;
			let furniture = "";
			let type = "";
			let href = "";

			for (const cell of cells) {
				const cellClass = this.getAttributeValue(cell, "class") || "";

				if (cellClass.includes("views-field-field-room-number")) {
					number = this.getElementText(cell);
					const anchorTags = this.findNodes(cell, (node) => node.tagName === "a");
					if (anchorTags.length > 0) {
						href = this.getAttributeValue(anchorTags[0], "href") || "";
					}
				} else if (cellClass.includes("views-field-field-room-capacity")) {
					seats = parseInt(this.getElementText(cell), 10) || 0;
				} else if (cellClass.includes("views-field-field-room-furniture")) {
					furniture = this.getElementText(cell);
				} else if (cellClass.includes("views-field-field-room-type")) {
					type = this.getElementText(cell);
				}
			}

			if (number && href && furniture && type && seats > 0) {
				// CRITICAL CHECKPOINT 2 CONSTRAINTS:
				// 1. Generate unique room name signature string format: shortname + "_" + number
				const name = `${buildingMeta.shortname}_${number}`;

				discoveredRooms.push({
					fullname: buildingMeta.fullname,
					shortname: buildingMeta.shortname,
					number: number,
					name: name,
					address: buildingMeta.address,
					lat: buildingMeta.lat,
					lon: buildingMeta.lon,
					seats: seats,
					type: type,
					furniture: furniture,
					href: href,
				});
			}
		}

		return discoveredRooms;
	}

	/**
	 * Hits the university web service asynchronously to retrieve lat/lon coordinates.
	 */
	public getCoordinates(address: string): Promise<GeoResponse> {
		const teamNum = "059"; // Replace with your explicit 3-digit CPSC 310 team number
		const encodedAddress = encodeURIComponent(address);
		const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team${teamNum}/${encodedAddress}`;

		return new Promise((resolve, reject) => {
			http
				.get(url, (res) => {
					let rawData = "";
					res.on("data", (chunk) => {
						rawData += chunk;
					});
					res.on("end", () => {
						try {
							const parsedData: GeoResponse = JSON.parse(rawData);
							resolve(parsedData);
						} catch (e) {
							resolve({ error: "Failed to parse coordinate response payload" });
						}
					});
				})
				.on("error", (err) => {
					resolve({ error: err.message });
				});
		});
	}

