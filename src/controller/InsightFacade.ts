import JSZip from "jszip";
import fs from "fs-extra";
import {
  IInsightFacade,
  InsightDataset,
  InsightDatasetKind,
  InsightError,
  InsightResult,
  NotFoundError,
  ResultTooLargeError,
} from "./IInsightFacade";

const DATA_DIR = "./data";
import path from "path";
import * as parse5 from "parse5";

/**
 * This is the main programmatic entry point for the project.
 * Method documentation is in IInsightFacade
 *
 */
export default class InsightFacade implements IInsightFacade {
  // in-memory cache of datasets for answering queries
  private datasets: Map<string, any> = new Map();
  private validMFields = ["avg", "pass", "fail", "audit", "year"];
  private validSFields = ["dept", "id", "instructor", "title", "uuid"];
  private initialized = false;

  // helper to initialize disk
  private async initialize() {
    // initialize once only
    if (this.initialized) return;
    this.initialized = true;
    await this.loadFromDisk();
  }

  // helper to load stored datasets from disk
  private async loadFromDisk(): Promise<void> {
    if (!(await fs.pathExists(DATA_DIR))) return;

    // read persisted dataset files into memory
    const files = await fs.readdir(DATA_DIR);
    for (const file of files) {
      // skip non-json files
      if (!file.endsWith(".json")) continue;
      try {
        const stored = await fs.readJSON(path.join(DATA_DIR, file));
        this.datasets.set(stored.metadata.id, stored);
      } catch {
        // skip corrupt files
      }
    }
  }

  public async addDataset(
    id: string,
    content: string,
    kind: InsightDatasetKind,
  ): Promise<string[]> {
    await this.initialize();

    // reject invalid dataset id
    if (id.trim().length === 0 || id.includes("_")) {
      throw new InsightError("Error: Invalid dataset id");
    }

    // reject already existing dataset id
    if (this.datasets.has(id)) {
      throw new InsightError("Error: Dataset with this id already exists");
    }

    // validate content
    if (content === null || content === undefined) {
      throw new InsightError("Error: No content provided");
    }

    // get course files
    const zip = await JSZip.loadAsync(content, { base64: true });
    let rows: any[];

    if (kind === InsightDatasetKind.Sections) {
      rows = await this.parseSection(zip);
    } else if (kind === InsightDatasetKind.Rooms) {
      rows = await this.parseRooms(zip);
    } else {
      throw new InsightError("Error: Invalid dataset kind");
    }

    // no valid found in dataset
    if (rows.length === 0) {
      throw new InsightError("Error: No valid rows found in dataset");
    }

    // dataset object to be stored
    const datasetIds = {
      metadata: { id, kind, numRows: rows.length },
      rows,
    };

    // persist to disk
    await fs.ensureDir(DATA_DIR);
    await fs.writeJSON(path.join(DATA_DIR, `${id}.json`), datasetIds);

    // load into memory
    this.datasets.set(id, datasetIds);

    // return all dataset ids
    return Array.from(this.datasets.keys());
  }

  private async parseSection(zip: JSZip): Promise<any[]> {
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
    // get index.htm file
    const indexFile = zip.file("index.htm");
    if (!indexFile) {
      throw new InsightError("Error: No index.htm file found in dataset");
    }

    // get building info from index.htm
    const indexHtml = await indexFile.async("text");
    const buildings = parseBuildings(indexHtml);

    const rooms: any[] = [];
    await Promise.all(
      buildings.map(async (building) => {
        // get building geolocation
        const geo = await getGeoLocation(building.address); // TODO
        if (!geo || geo.error) return;

        const filePath = building.href.replace("./", "");
        const buildingFile = zip.file(filePath);
        if (!buildingFile) return;

        const buildingHtml = await buildingFile.async("text");
        const buildingRooms = parseRoomTable(buildingHtml, building, geo); // TODO
        rooms.push(...buildingRooms);
      }),
    );
    return rooms;
  }

  public async removeDataset(id: string): Promise<string> {
    await this.initialize();

    // reject invalid dataset id
    if (id.trim().length === 0 || id.includes("_")) {
      throw new InsightError("Error: Invalid dataset id");
    }

    // check if dataset exists in memory
    if (!this.datasets.has(id)) {
      throw new NotFoundError("Error: Dataset id not found");
    }

    // remove dataset from memory
    this.datasets.delete(id);

    // remove from disk
    await fs.remove(path.join(DATA_DIR, `${id}.json`));

    return id;
  }

  public async performQuery(query: unknown): Promise<InsightResult[]> {
    await this.initialize();

    // validate query structure
    const datasetID = this.validateQuery(query);

    // check if queried dataset exists
    if (!this.datasets.has(datasetID)) {
      throw new InsightError("Error: Dataset not found");
    }

    const dataset = this.datasets.get(datasetID);
    const sections = dataset.rows;

    // get each part of the query
    const queryObj = query as Record<string, unknown>;
    const where = queryObj.WHERE as Record<string, unknown>;
    const options = queryObj.OPTIONS as Record<string, unknown>;
    const columns = options.COLUMNS as string[];
    const order = options.ORDER as string | undefined;

    // apply where filter
    let filtered: any[];
    if (Object.keys(where).length === 0) {
      // empty WHERE case
      filtered = sections;
    } else {
      // apply filter to each section
      filtered = sections.filter((section: any) =>
        this.applyFilter(section, where),
      );
    }

    // apply columns
    const results = filtered.map((section: any) =>
      this.applyColumns(section, columns),
    );

    // sort by order
    if (order) {
      results.sort((a, b) => {
        if (a[order] < b[order]) return -1;
        if (a[order] > b[order]) return 1;
        return 0;
      });
    }

    // check results size
    if (results.length > 5000) {
      throw new ResultTooLargeError("Error: Query results exceed 5000");
    }

    return results;
  }

  public async listDatasets(): Promise<InsightDataset[]> {
    await this.initialize();
    return Array.from(this.datasets.values()).map(
      (dataset) => dataset.metadata,
    );
  }

  // helper to validate query format
  private validateQuery(query: unknown): string {
    // reject non-object queries
    if (typeof query !== "object" || query === null || Array.isArray(query)) {
      throw new InsightError("Error: Query is not an object");
    }

    const queryObj = query as Record<string, unknown>;

    // check for WHERE and OPTIONS
    if (!("WHERE" in queryObj) || !("OPTIONS" in queryObj)) {
      throw new InsightError("Error: Query must contain WHERE and OPTIONS");
    }

    // ensure that it only has WHERE and OPTIONS
    const validKeys = new Set(["WHERE", "OPTIONS"]);
    for (const key of Object.keys(queryObj)) {
      if (!validKeys.has(key)) {
        throw new InsightError("Error: Unexpected query key found");
      }
    }

    // continue validating WHERE and OPTIONS
    this.validateWhere(queryObj.WHERE);
    this.validateOptions(queryObj.OPTIONS);

    return this.getDatasetID(queryObj);
  }

  // helper to validate WHERE
  private validateWhere(where: unknown): void {
    // reject non-object WHERE
    if (typeof where !== "object" || where === null || Array.isArray(where)) {
      throw new InsightError("Error: WHERE is not an object");
    }

    const whereObj = where as Record<string, unknown>;
    const keys = Object.keys(whereObj);

    // empty WHERE is valid
    if (keys.length === 0) return;

    // WHERE can only have one filter
    if (keys.length > 1) {
      throw new InsightError("Error: WHERE must have only one filter");
    }

    this.validateFilter(whereObj);
  }

  // helper to recursively validate filters
  private validateFilter(filter: unknown): void {
    // check that filter is an object
    if (
      typeof filter !== "object" ||
      filter === null ||
      Array.isArray(filter)
    ) {
      throw new InsightError("Error: Filter is not an object");
    }

    const filterObj = filter as Record<string, unknown>;
    const keys = Object.keys(filterObj);

    // filter must have exactly one key
    if (keys.length !== 1) {
      throw new InsightError("Error: Filter must have exactly one key");
    }

    const filterType = keys[0];
    const filterContent = filterObj[filterType];

    // handle different filter types
    switch (filterType) {
      case "NOT":
        this.validateFilter(filterContent);
        break;
      case "AND":
      case "OR":
        if (!Array.isArray(filterContent) || filterContent.length === 0) {
          throw new InsightError("Error: Filter must be non-empty array");
        }
        // recursively validate each sub-filter
        for (const subFilter of filterContent as unknown[]) {
          this.validateFilter(subFilter);
        }
        break;
      case "LT":
      case "GT":
      case "EQ":
        this.validateComparison(filterContent, "m");
        break;
      case "IS":
        this.validateComparison(filterContent, "s");
        break;
      default:
        // invalid filter type
        throw new InsightError("Error: Invalid filter type");
    }
  }

  // helper to validate comparison
  private validateComparison(content: unknown, type: string): void {
    // reject non-object content
    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content)
    ) {
      throw new InsightError("Error: Comparison content is not an object");
    }

    const contentObj = content as Record<string, unknown>;
    const keys = Object.keys(contentObj);

    // must have exactly one key
    if (keys.length !== 1) {
      throw new InsightError("Error: Comparison must have exactly one key");
    }

    const key = keys[0];
    this.validateKey(key, type);

    // ensure that the value is correct type
    if (type === "m" && typeof contentObj[key] !== "number") {
      throw new InsightError("Error: MComparison value must be a number");
    }
    if (type === "s" && typeof contentObj[key] !== "string") {
      throw new InsightError("Error: SComparison value must be a string");
    }

    // wildcards for type s
    if (type === "s") {
      const value = contentObj[key] as string;
      // strip * from start and end if possible
      let stripped = value;
      if (value.startsWith("*")) {
        stripped = value.slice(1);
      }
      let final = stripped;
      if (stripped.endsWith("*")) {
        final = stripped.slice(0, -1);
      }
      if (final.includes("*")) {
        throw new InsightError(
          "Error: Wildcards only allowed at start and end",
        );
      }
    }
  }

  // helper to validate comparison keys
  private validateKey(key: string, type?: string): void {
    // split key into id and field
    const parts = key.split("_");
    if (parts.length !== 2) {
      throw new InsightError("Error: Invalid Comparison key format");
    }

    // check that key field is valid
    const [id, field] = parts;
    if (id.trim().length === 0) {
      throw new InsightError("Error: Empty id");
    }
    let validFields: string[];
    if (type === "m") {
      validFields = this.validMFields;
    } else if (type === "s") {
      validFields = this.validSFields;
    } else {
      validFields = [...this.validMFields, ...this.validSFields];
    }

    if (!validFields.includes(field)) {
      throw new InsightError("Error: Invalid Comparison key field");
    }
  }

  // helper to validate OPTIONS
  private validateOptions(options: unknown): void {
    // reject non-object OPTIONS
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options)
    ) {
      throw new InsightError("Error: OPTIONS is not an object");
    }

    const optionsObj = options as Record<string, unknown>;

    // ensure that it only has COLUMNS and optionally ORDER
    const validKeys = new Set(["COLUMNS", "ORDER"]);
    for (const key of Object.keys(optionsObj)) {
      if (!validKeys.has(key)) {
        throw new InsightError("Error: Unexpected OPTIONS key found");
      }
    }

    // check for COLUMNS and that it is an non-empty array
    if (!("COLUMNS" in optionsObj)) {
      throw new InsightError("Error: OPTIONS must contain COLUMNS");
    }

    if (!Array.isArray(optionsObj.COLUMNS) || optionsObj.COLUMNS.length === 0) {
      throw new InsightError("Error: COLUMNS cannot be an empty array");
    }

    // ensure each key in COLUMNS is a string
    for (const key of optionsObj.COLUMNS) {
      if (typeof key !== "string") {
        throw new InsightError("Error: COLUMNS must be an array of strings");
      }
      this.validateKey(key);
    }

    // check ORDER
    if ("ORDER" in optionsObj) {
      if (typeof optionsObj.ORDER !== "string") {
        throw new InsightError("Error: ORDER must be a string");
      }

      // ensure that ORDER fields are in COLUMNS
      if (!(optionsObj.COLUMNS as string[]).includes(optionsObj.ORDER)) {
        throw new InsightError("Error: ORDER field(s) must be in COLUMNS");
      }
      this.validateKey(optionsObj.ORDER);
    }
  }

  // helper to get dataset ID
  private getDatasetID(query: Record<string, unknown>): string {
    const options = query.OPTIONS as Record<string, unknown>;
    const columns = options.COLUMNS as string[];

    // get ids from each key
    const ids = new Set(columns.map((key) => key.split("_")[0]));

    // ensure query references one dataset
    if (ids.size !== 1) {
      throw new InsightError("Error: Query references multiple datasets");
    }

    return Array.from(ids)[0];
  }

  // helper to determine whether a section matches filter condition
  private applyFilter(section: any, filter: Record<string, unknown>): boolean {
    const filterType = Object.keys(filter)[0];
    const filterContent = filter[filterType];

    // handle filters
    switch (filterType) {
      case "NOT":
        return !this.applyFilter(
          section,
          filterContent as Record<string, unknown>,
        );
      case "AND":
        return (filterContent as unknown[]).every((subfilter) =>
          this.applyFilter(section, subfilter as Record<string, unknown>),
        );
      case "OR":
        return (filterContent as unknown[]).some((subfilter) =>
          this.applyFilter(section, subfilter as Record<string, unknown>),
        );
      case "LT":
      case "GT":
      case "EQ":
      case "IS":
        return this.applyComparison(
          section,
          filterContent as Record<string, unknown>,
          filterType,
        );
    }
    return false;
  }

  // helper that checks if section field values match filter
  private applyComparison(
    section: any,
    content: Record<string, unknown>,
    comparator: string,
  ): boolean {
    const key = Object.keys(content)[0];
    const field = key.split("_")[1];
    const value = content[key];
    const sectionValue = section[field];

    // handle each comparison case
    switch (comparator) {
      case "LT":
        return sectionValue < (value as number);
      case "GT":
        return sectionValue > (value as number);
      case "EQ":
        return sectionValue === (value as number);
      case "IS":
        // wildcards
        const strValue = value as string;
        const strSectionValue = sectionValue as string;

        // match everything
        if (strValue === "*") return true;

        // wildcards on both ends
        if (strValue.startsWith("*") && strValue.endsWith("*")) {
          return strSectionValue.includes(strValue.slice(1, -1));
        }

        // wildcard only at start or end
        if (strValue.startsWith("*")) {
          return strSectionValue.endsWith(strValue.slice(1));
        }
        if (strValue.endsWith("*")) {
          return strSectionValue.startsWith(strValue.slice(0, -1));
        }

        // no wildcards
        return strSectionValue === strValue;
    }
    return false;
  }

  // helper that only keeps fields specified in COLUMNS of a section
  private applyColumns(section: any, columns: string[]): InsightResult {
    const result: InsightResult = {};

    // build object with COLUMN fields for each section
    for (const col of columns) {
      const field = col.split("_")[1];
      result[col] = section[field];
    }

    return result;
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

  // convert into nodes for traversal
  const document = parse5.parse(html);

  // find valid room table
  const table = findBuildingTable(document);
  if (!table) return buildings;

  // find tbody element that contains data rows
  const tableRows = findNode(table, "tbody");
  if (!tableRows) return buildings;

  // ensure array only contains tr elements
  const rows = tableRows.childNodes.filter(
    (node: any) => node.tagName === "tr",
  );

  // get buildings with valid fields
  for (const row of rows) {
    const building = getBuildingInfo(row);
    if (building) {
      buildings.push(building);
    }
  }

  return buildings;
}

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
  if (node.tagName === name) {
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

function findNode(node: any, name: string): any {
  if (node.tagName === name) return node;

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

function getBuildingInfo(row: any): any | null {
  const cells = row.childNodes.filter((node: any) => node.tagName === "td");

  let link: string | null = null;
  let shortname: string | null = null;
  let fullname: string | null = null;
  let address: string | null = null;

  for (const cell of cells) {
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
  return { link, shortname, fullname, address };
}

function getTextContent(node: any): string {
  return "";
}

// end of parseBuilding helper functions

// helper to get geolocation of an address
async function getGeoLocation(address: string): Promise<any> {
  const encoded = encodeURIComponent(address);
  const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team059/${encoded}`;
  const response = fetch(url);
  return (await response).json() as Promise<any>;
}

// helper to parse room files
function parseRoomTable(html: string, building: any, geo: any): any[] {
  const rooms: any[] = [];

  return rooms;
}
