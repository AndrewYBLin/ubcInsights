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

  public async addDataset(
    id: string,
    content: string,
    kind: InsightDatasetKind,
  ): Promise<string[]> {
    // validate id and content
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

    // get course files
    const zip = await JSZip.loadAsync(content, { base64: true });
    let rows: any[];

    if (kind === InsightDatasetKind.Sections) {
      rows = await this.parseSections(zip);
    } else if (kind === InsightDatasetKind.Rooms) {
      rows = await this.parseRooms(zip);
    } else {
      throw new InsightError("Error: Invalid dataset kind");
    }

    // no valid found in dataset
    if (rows.length === 0) {
      throw new InsightError("Error: No valid rows found in dataset");
    }

    await fs.ensureDir("./data");
    await fs.writeJson(`./data/${id}.json`, { kind, rows });

    // const newDataset: InsightDataset = {
    // 	id: id,
    // 	kind: kind,
    // 	numRows: sections.length,
    // };
    this.datasets.set(id, { id: id, kind: kind, numRows: rows.length });

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
    if (
      typeof notVal !== "object" ||
      notVal === null ||
      Array.isArray(notVal)
    ) {
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
        return content.every((subFilter: any) =>
          this.isSectionValid(section, subFilter),
        );
      case "OR":
        // At least one filter in the list must be true
        return content.some((subFilter: any) =>
          this.isSectionValid(section, subFilter),
        );
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

  private handleMComp(
    section: any,
    comparison: any,
    op: (a: number, b: number) => boolean,
  ): boolean {
    const queryKey = Object.keys(comparison)[0]; // e.g., "sections_avg"
    const targetValue = comparison[queryKey]; // e.g., 90
    const field = queryKey.split("_")[1]; // e.g., "avg"

    // Convert section "Year" to number if needed (some datasets use strings for years)
    let sectionValue = section[this.fieldToKey[field]];
    if (field === "year") {
      sectionValue =
        section.Section === "overall"
          ? this.overallNumber
          : parseInt(sectionValue, 10);
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
        value =
          section.Section === "overall"
            ? this.overallNumber
            : parseInt(value, 10);
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
    if (
      keys.length !== 2 ||
      !keys.includes("WHERE") ||
      !keys.includes("OPTIONS")
    ) {
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
    if (
      typeof filter !== "object" ||
      filter === null ||
      Array.isArray(filter)
    ) {
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
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options)
    ) {
      return false;
    }

    // 2. Validate COLUMNS (Mandatory)
    if (
      !Object.keys(options).includes("COLUMNS") ||
      !Array.isArray(options.COLUMNS) ||
      options.COLUMNS.length === 0
    ) {
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
      return Promise.reject(
        new InsightError("Query must be a non-null object"),
      );
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
      const data = await fs.readJson(path);
      return data.rows;
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

  private async parseSections(zip: JSZip): Promise<any[]> {
    const courseFiles = Object.values(zip.files).filter(
      (file) => file.name.startsWith("courses/") && !file.dir,
    );

    if (courseFiles.length === 0) {
      throw new InsightError("Error: No course files found in dataset");
    }

    const sections: any[] = [];

    // parse each course file and extract sections
    await Promise.all(
      // parse each course
      courseFiles.map(async (file) => {
        let course: any;
        try {
          const text = await file.async("text");
          course = JSON.parse(text);
        } catch {
          // skip corrupt files
          return;
        }

        if (course === null || course === undefined) return;
        const results = course.result;
        if (!Array.isArray(results)) return;

        // get sections of a course
        for (const row of results) {
          const section = parseSection(row);
          if (section !== null) {
            sections.push(section);
          }
        }
      }),
    );

    return sections;
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
      }),
    );

    return rooms;
  }
}

// helper to parse (and validate fields of) a section
function parseSection(row: any): any | null {
  // special case when Section = overall
  let year: number;
  if (row.Section === "overall") {
    year = 1900;
  } else {
    year = Number(row.Year);
  }

  const hasRequiredFields =
    row.id !== undefined &&
    row.Course !== undefined &&
    row.Title !== undefined &&
    row.Professor !== undefined &&
    row.Subject !== undefined &&
    row.Year !== undefined &&
    row.Avg !== undefined &&
    row.Pass !== undefined &&
    row.Fail !== undefined &&
    row.Audit !== undefined;

  // missing one or more required fields
  if (!hasRequiredFields) return null;

  return {
    uuid: String(row.id),
    id: String(row.Course),
    title: String(row.Title),
    instructor: String(row.Professor),
    dept: String(row.Subject),
    year: year,
    avg: Number(row.Avg),
    pass: Number(row.Pass),
    fail: Number(row.Fail),
    audit: Number(row.Audit),
  };
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
  geo: { lat: number; lon: number },
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
    const hasRoomNumber = tds.some((td: any) =>
      hasClass(td, "views-field-field-room-number"),
    );
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
  geo: { lat: number; lon: number },
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
      number = anchor
        ? getTextContent(anchor).trim()
        : getTextContent(cell).trim();
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
  if (
    !number ||
    seats === null ||
    isNaN(seats) ||
    !furniture ||
    !type ||
    !href
  ) {
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
  address: string,
): Promise<{ lat: number; lon: number; error?: string | undefined } | null> {
  try {
    const encodedAddress = encodeURIComponent(address);
    const url =
      "http://cs310.students.cs.ubc.ca:11316/api/v1/project_team059/${encodedAddress}";

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      lat?: number;
      lon?: number;
      error?: string;
    };

    // geolocation fail
    if (data.error) return { lat: 0, lon: 0, error: data.error };

    if (typeof data.lat !== "number" || typeof data.lon !== "number")
      return null;

    return { lat: data.lat, lon: data.lon };
  } catch {
    return null;
  }
}
