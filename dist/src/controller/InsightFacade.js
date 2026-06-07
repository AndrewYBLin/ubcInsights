"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jszip_1 = __importDefault(require("jszip"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const IInsightFacade_1 = require("./IInsightFacade");
const DATA_DIR = "./data";
const path_1 = __importDefault(require("path"));
const parse5 = __importStar(require("parse5"));
class InsightFacade {
    datasets = new Map();
    validMFields = ["avg", "pass", "fail", "audit", "year"];
    validSFields = ["dept", "id", "instructor", "title", "uuid"];
    initialized = false;
    async initialize() {
        if (this.initialized)
            return;
        this.initialized = true;
        await this.loadFromDisk();
    }
    async loadFromDisk() {
        if (!(await fs_extra_1.default.pathExists(DATA_DIR)))
            return;
        const files = await fs_extra_1.default.readdir(DATA_DIR);
        for (const file of files) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const stored = await fs_extra_1.default.readJSON(path_1.default.join(DATA_DIR, file));
                this.datasets.set(stored.metadata.id, stored);
            }
            catch {
            }
        }
    }
    async addDataset(id, content, kind) {
        await this.initialize();
        if (id.trim().length === 0 || id.includes("_")) {
            throw new IInsightFacade_1.InsightError("Error: Invalid dataset id");
        }
        if (this.datasets.has(id)) {
            throw new IInsightFacade_1.InsightError("Error: Dataset with this id already exists");
        }
        if (content === null || content === undefined) {
            throw new IInsightFacade_1.InsightError("Error: No content provided");
        }
        const zip = await jszip_1.default.loadAsync(content, { base64: true });
        let rows;
        if (kind === IInsightFacade_1.InsightDatasetKind.Sections) {
            rows = await this.parseSection(zip);
        }
        else if (kind === IInsightFacade_1.InsightDatasetKind.Rooms) {
            rows = await this.parseRooms(zip);
        }
        else {
            throw new IInsightFacade_1.InsightError("Error: Invalid dataset kind");
        }
        if (rows.length === 0) {
            throw new IInsightFacade_1.InsightError("Error: No valid rows found in dataset");
        }
        const datasetIds = {
            metadata: { id, kind, numRows: rows.length },
            rows,
        };
        await fs_extra_1.default.ensureDir(DATA_DIR);
        await fs_extra_1.default.writeJSON(path_1.default.join(DATA_DIR, `${id}.json`), datasetIds);
        this.datasets.set(id, datasetIds);
        return Array.from(this.datasets.keys());
    }
    async parseSection(zip) {
        const courseFiles = Object.values(zip.files).filter((file) => file.name.startsWith("courses/") && !file.dir);
        if (courseFiles.length === 0) {
            throw new IInsightFacade_1.InsightError("Error: No course files found in dataset");
        }
        const sections = [];
        await Promise.all(courseFiles.map(async (file) => {
            let course;
            try {
                const text = await file.async("text");
                course = JSON.parse(text);
            }
            catch {
                return;
            }
            if (course === null || course === undefined)
                return;
            const results = course.result;
            if (!Array.isArray(results))
                return;
            for (const row of results) {
                const section = parseSection(row);
                if (section !== null) {
                    sections.push(section);
                }
            }
        }));
        return sections;
    }
    async parseRooms(zip) {
        const indexFile = zip.file("index.htm");
        if (!indexFile) {
            throw new IInsightFacade_1.InsightError("Error: No index.htm file found in dataset");
        }
        const indexHtml = await indexFile.async("text");
        const buildings = parseBuildings(indexHtml);
        const rooms = [];
        await Promise.all(buildings.map(async (building) => {
            const geo = await getGeoLocation(building.address);
            if (!geo || geo.error)
                return;
            const filePath = building.href.replace("./", "");
            const buildingFile = zip.file(filePath);
            if (!buildingFile)
                return;
            const buildingHtml = await buildingFile.async("text");
            const buildingRooms = parseRoomTable(buildingHtml, building, geo);
            rooms.push(...buildingRooms);
        }));
        return rooms;
    }
    async removeDataset(id) {
        await this.initialize();
        if (id.trim().length === 0 || id.includes("_")) {
            throw new IInsightFacade_1.InsightError("Error: Invalid dataset id");
        }
        if (!this.datasets.has(id)) {
            throw new IInsightFacade_1.NotFoundError("Error: Dataset id not found");
        }
        this.datasets.delete(id);
        await fs_extra_1.default.remove(path_1.default.join(DATA_DIR, `${id}.json`));
        return id;
    }
    async performQuery(query) {
        await this.initialize();
        const datasetID = this.validateQuery(query);
        if (!this.datasets.has(datasetID)) {
            throw new IInsightFacade_1.InsightError("Error: Dataset not found");
        }
        const dataset = this.datasets.get(datasetID);
        const sections = dataset.rows;
        const queryObj = query;
        const where = queryObj.WHERE;
        const options = queryObj.OPTIONS;
        const columns = options.COLUMNS;
        const order = options.ORDER;
        let filtered;
        if (Object.keys(where).length === 0) {
            filtered = sections;
        }
        else {
            filtered = sections.filter((section) => this.applyFilter(section, where));
        }
        const results = filtered.map((section) => this.applyColumns(section, columns));
        if (order) {
            results.sort((a, b) => {
                if (a[order] < b[order])
                    return -1;
                if (a[order] > b[order])
                    return 1;
                return 0;
            });
        }
        if (results.length > 5000) {
            throw new IInsightFacade_1.ResultTooLargeError("Error: Query results exceed 5000");
        }
        return results;
    }
    async listDatasets() {
        await this.initialize();
        return Array.from(this.datasets.values()).map((dataset) => dataset.metadata);
    }
    validateQuery(query) {
        if (typeof query !== "object" || query === null || Array.isArray(query)) {
            throw new IInsightFacade_1.InsightError("Error: Query is not an object");
        }
        const queryObj = query;
        if (!("WHERE" in queryObj) || !("OPTIONS" in queryObj)) {
            throw new IInsightFacade_1.InsightError("Error: Query must contain WHERE and OPTIONS");
        }
        const validKeys = new Set(["WHERE", "OPTIONS"]);
        for (const key of Object.keys(queryObj)) {
            if (!validKeys.has(key)) {
                throw new IInsightFacade_1.InsightError("Error: Unexpected query key found");
            }
        }
        this.validateWhere(queryObj.WHERE);
        this.validateOptions(queryObj.OPTIONS);
        return this.getDatasetID(queryObj);
    }
    validateWhere(where) {
        if (typeof where !== "object" || where === null || Array.isArray(where)) {
            throw new IInsightFacade_1.InsightError("Error: WHERE is not an object");
        }
        const whereObj = where;
        const keys = Object.keys(whereObj);
        if (keys.length === 0)
            return;
        if (keys.length > 1) {
            throw new IInsightFacade_1.InsightError("Error: WHERE must have only one filter");
        }
        this.validateFilter(whereObj);
    }
    validateFilter(filter) {
        if (typeof filter !== "object" ||
            filter === null ||
            Array.isArray(filter)) {
            throw new IInsightFacade_1.InsightError("Error: Filter is not an object");
        }
        const filterObj = filter;
        const keys = Object.keys(filterObj);
        if (keys.length !== 1) {
            throw new IInsightFacade_1.InsightError("Error: Filter must have exactly one key");
        }
        const filterType = keys[0];
        const filterContent = filterObj[filterType];
        switch (filterType) {
            case "NOT":
                this.validateFilter(filterContent);
                break;
            case "AND":
            case "OR":
                if (!Array.isArray(filterContent) || filterContent.length === 0) {
                    throw new IInsightFacade_1.InsightError("Error: Filter must be non-empty array");
                }
                for (const subFilter of filterContent) {
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
                throw new IInsightFacade_1.InsightError("Error: Invalid filter type");
        }
    }
    validateComparison(content, type) {
        if (typeof content !== "object" ||
            content === null ||
            Array.isArray(content)) {
            throw new IInsightFacade_1.InsightError("Error: Comparison content is not an object");
        }
        const contentObj = content;
        const keys = Object.keys(contentObj);
        if (keys.length !== 1) {
            throw new IInsightFacade_1.InsightError("Error: Comparison must have exactly one key");
        }
        const key = keys[0];
        this.validateKey(key, type);
        if (type === "m" && typeof contentObj[key] !== "number") {
            throw new IInsightFacade_1.InsightError("Error: MComparison value must be a number");
        }
        if (type === "s" && typeof contentObj[key] !== "string") {
            throw new IInsightFacade_1.InsightError("Error: SComparison value must be a string");
        }
        if (type === "s") {
            const value = contentObj[key];
            let stripped = value;
            if (value.startsWith("*")) {
                stripped = value.slice(1);
            }
            let final = stripped;
            if (stripped.endsWith("*")) {
                final = stripped.slice(0, -1);
            }
            if (final.includes("*")) {
                throw new IInsightFacade_1.InsightError("Error: Wildcards only allowed at start and end");
            }
        }
    }
    validateKey(key, type) {
        const parts = key.split("_");
        if (parts.length !== 2) {
            throw new IInsightFacade_1.InsightError("Error: Invalid Comparison key format");
        }
        const [id, field] = parts;
        if (id.trim().length === 0) {
            throw new IInsightFacade_1.InsightError("Error: Empty id");
        }
        let validFields;
        if (type === "m") {
            validFields = this.validMFields;
        }
        else if (type === "s") {
            validFields = this.validSFields;
        }
        else {
            validFields = [...this.validMFields, ...this.validSFields];
        }
        if (!validFields.includes(field)) {
            throw new IInsightFacade_1.InsightError("Error: Invalid Comparison key field");
        }
    }
    validateOptions(options) {
        if (typeof options !== "object" ||
            options === null ||
            Array.isArray(options)) {
            throw new IInsightFacade_1.InsightError("Error: OPTIONS is not an object");
        }
        const optionsObj = options;
        const validKeys = new Set(["COLUMNS", "ORDER"]);
        for (const key of Object.keys(optionsObj)) {
            if (!validKeys.has(key)) {
                throw new IInsightFacade_1.InsightError("Error: Unexpected OPTIONS key found");
            }
        }
        if (!("COLUMNS" in optionsObj)) {
            throw new IInsightFacade_1.InsightError("Error: OPTIONS must contain COLUMNS");
        }
        if (!Array.isArray(optionsObj.COLUMNS) || optionsObj.COLUMNS.length === 0) {
            throw new IInsightFacade_1.InsightError("Error: COLUMNS cannot be an empty array");
        }
        for (const key of optionsObj.COLUMNS) {
            if (typeof key !== "string") {
                throw new IInsightFacade_1.InsightError("Error: COLUMNS must be an array of strings");
            }
            this.validateKey(key);
        }
        if ("ORDER" in optionsObj) {
            if (typeof optionsObj.ORDER !== "string") {
                throw new IInsightFacade_1.InsightError("Error: ORDER must be a string");
            }
            if (!optionsObj.COLUMNS.includes(optionsObj.ORDER)) {
                throw new IInsightFacade_1.InsightError("Error: ORDER field(s) must be in COLUMNS");
            }
            this.validateKey(optionsObj.ORDER);
        }
    }
    getDatasetID(query) {
        const options = query.OPTIONS;
        const columns = options.COLUMNS;
        const ids = new Set(columns.map((key) => key.split("_")[0]));
        if (ids.size !== 1) {
            throw new IInsightFacade_1.InsightError("Error: Query references multiple datasets");
        }
        return Array.from(ids)[0];
    }
    applyFilter(section, filter) {
        const filterType = Object.keys(filter)[0];
        const filterContent = filter[filterType];
        switch (filterType) {
            case "NOT":
                return !this.applyFilter(section, filterContent);
            case "AND":
                return filterContent.every((subfilter) => this.applyFilter(section, subfilter));
            case "OR":
                return filterContent.some((subfilter) => this.applyFilter(section, subfilter));
            case "LT":
            case "GT":
            case "EQ":
            case "IS":
                return this.applyComparison(section, filterContent, filterType);
        }
        return false;
    }
    applyComparison(section, content, comparator) {
        const key = Object.keys(content)[0];
        const field = key.split("_")[1];
        const value = content[key];
        const sectionValue = section[field];
        switch (comparator) {
            case "LT":
                return sectionValue < value;
            case "GT":
                return sectionValue > value;
            case "EQ":
                return sectionValue === value;
            case "IS":
                const strValue = value;
                const strSectionValue = sectionValue;
                if (strValue === "*")
                    return true;
                if (strValue.startsWith("*") && strValue.endsWith("*")) {
                    return strSectionValue.includes(strValue.slice(1, -1));
                }
                if (strValue.startsWith("*")) {
                    return strSectionValue.endsWith(strValue.slice(1));
                }
                if (strValue.endsWith("*")) {
                    return strSectionValue.startsWith(strValue.slice(0, -1));
                }
                return strSectionValue === strValue;
        }
        return false;
    }
    applyColumns(section, columns) {
        const result = {};
        for (const col of columns) {
            const field = col.split("_")[1];
            result[col] = section[field];
        }
        return result;
    }
}
exports.default = InsightFacade;
function parseSection(row) {
    let year;
    if (row.Section === "overall") {
        year = 1900;
    }
    else {
        year = Number(row.Year);
    }
    const hasRequiredFields = row.id !== undefined &&
        row.Course !== undefined &&
        row.Title !== undefined &&
        row.Professor !== undefined &&
        row.Subject !== undefined &&
        row.Year !== undefined &&
        row.Avg !== undefined &&
        row.Pass !== undefined &&
        row.Fail !== undefined &&
        row.Audit !== undefined;
    if (!hasRequiredFields)
        return null;
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
function parseBuildings(html) {
    const buildings = [];
    const document = parse5.parse(html);
    const table = findBuildingTable(document);
    if (!table)
        return buildings;
    const tableRows = findNode(table, "tbody");
    if (!tableRows)
        return buildings;
    const rows = tableRows.childNodes.filter((node) => node.tagName === "tr");
    for (const row of rows) {
        const building = getBuildingInfo(row);
        if (building) {
            buildings.push(building);
        }
    }
    return buildings;
}
function findBuildingTable(node) {
    if (node.nodeName === "table") {
        if (tableHasClass(node, "views-field-title")) {
            return node;
        }
    }
    if (node.childNodes) {
        for (const child of node.childNodes) {
            const result = findBuildingTable(child);
            if (result)
                return result;
        }
    }
    return null;
}
function tableHasClass(table, className) {
    const tds = findAllNodes(table, "td");
    return tds.some((td) => hasClass(td, className));
}
function findAllNodes(node, name) {
    const results = [];
    if (node.tagName === name) {
        results.push(node);
    }
    if (node.childNodes) {
        for (const child of node.childNodes) {
            results.push(...findAllNodes(child, name));
        }
    }
    return results;
}
function hasClass(node, className) {
    const classAttr = getAttribute(node, "class");
    if (!classAttr)
        return false;
    return classAttr.split(" ").includes(className);
}
function getAttribute(node, attrName) {
    if (!node.attrs)
        return null;
    const attr = node.attrs.find((a) => a.name === attrName);
    return attr ? attr.value : null;
}
function findNode(node, name) {
    if (node.tagName === name)
        return node;
    if (node.childNodes) {
        for (const child of node.childNodes) {
            const result = findNode(child, name);
            if (result)
                return result;
        }
    }
    return null;
}
function getBuildingInfo(row) {
    const cells = row.childNodes.filter((node) => node.tagName === "td");
    let link = null;
    let shortname = null;
    let fullname = null;
    let address = null;
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
    if (!link || !shortname || !fullname || !address)
        return null;
    return { link, shortname, fullname, address };
}
function getTextContent(node) {
    return "";
}
async function getGeoLocation(address) {
    const encoded = encodeURIComponent(address);
    const url = `http://cs310.students.cs.ubc.ca:11316/api/v1/project_team059/${encoded}`;
    const response = fetch(url);
    return (await response).json();
}
function parseRoomTable(html, building, geo) {
    const rooms = [];
    return rooms;
}
//# sourceMappingURL=InsightFacade.js.map