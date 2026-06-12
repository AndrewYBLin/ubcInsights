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
const IInsightFacade_1 = require("./IInsightFacade");
const jszip_1 = __importDefault(require("jszip"));
const fs = __importStar(require("fs-extra"));
const parse5 = __importStar(require("parse5"));
class InsightFacade {
    datasets;
    currentQueryId;
    constructor() {
        this.datasets = new Map();
        this.currentQueryId = "";
    }
    async initializeDatasets() {
        if (this.datasets.size > 0) {
            return;
        }
        if (await fs.pathExists("./data")) {
            const files = await fs.readdir("./data");
            const jsonFiles = files.filter((file) => file.endsWith(".json"));
            const readPromises = jsonFiles.map(async (fileName) => {
                return fs.readJson(`./data/${fileName}`).then((data) => {
                    return {
                        id: fileName.replace(".json", ""),
                        numRows: data.length,
                    };
                });
            });
            try {
                const results = await Promise.all(readPromises);
                for (const res of results) {
                    this.datasets.set(res.id, {
                        id: res.id,
                        kind: IInsightFacade_1.InsightDatasetKind.Sections,
                        numRows: res.numRows,
                    });
                }
            }
            catch (_err) {
            }
        }
    }
    async addDataset(id, content, kind) {
        await this.initializeDatasets();
        if (id === "" || id.includes("_") || id.trim().length === 0) {
            return Promise.reject(new IInsightFacade_1.InsightError("Invalid id"));
        }
        if (this.datasets.has(id)) {
            return Promise.reject(new IInsightFacade_1.InsightError("ID already exists"));
        }
        if (content === null || content === undefined) {
            throw new IInsightFacade_1.InsightError("No content provided");
        }
        const zip = await jszip_1.default.loadAsync(content, { base64: true });
        let rows;
        if (kind === IInsightFacade_1.InsightDatasetKind.Sections) {
            rows = await this.parseSections(zip);
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
        await fs.ensureDir("./data");
        await fs.writeJson(`./data/${id}.json`, { kind, rows });
        this.datasets.set(id, { id: id, kind: kind, numRows: rows.length });
        return Array.from(this.datasets.keys());
    }
    async removeDataset(id) {
        await this.initializeDatasets();
        if (id === "" || id.includes("_") || id.trim().length === 0) {
            return Promise.reject(new IInsightFacade_1.InsightError("Invalid id"));
        }
        if (!this.datasets.has(id)) {
            return Promise.reject(new IInsightFacade_1.NotFoundError("id not found"));
        }
        this.datasets.delete(id);
        try {
            await fs.remove(`./data/${id}.json`);
        }
        catch (_err) {
            return Promise.reject(new IInsightFacade_1.InsightError("Failed to delete data"));
        }
        return Promise.resolve(id);
    }
    overallNumber = 1900;
    resultLimit = 5000;
    fieldToKey = {
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
    validateKey(key, type) {
        if (typeof key !== "string")
            return false;
        const parts = key.split("_");
        if (parts.length !== 2)
            return false;
        const id = parts[0];
        const field = parts[1];
        if (this.currentQueryId === "") {
            this.currentQueryId = id;
        }
        else if (this.currentQueryId !== id) {
            return false;
        }
        if (!this.datasets.has(id))
            return false;
        const mfields = ["avg", "pass", "fail", "audit", "year"];
        const sfields = ["dept", "id", "instructor", "title", "uuid"];
        if (type === "mfield")
            return mfields.includes(field);
        if (type === "sfield")
            return sfields.includes(field);
        return mfields.includes(field) || sfields.includes(field);
    }
    isLogicComparisonValid(filterList) {
        if (!Array.isArray(filterList)) {
            return false;
        }
        if (filterList.length === 0) {
            return false;
        }
        for (const filter of filterList) {
            if (!this.isFilterValid(filter)) {
                return false;
            }
        }
        return true;
    }
    isMComparisonValid(mcomp) {
        if (typeof mcomp !== "object" || mcomp === null) {
            return false;
        }
        const keys = Object.keys(mcomp);
        if (keys.length !== 1) {
            return false;
        }
        const mkey = keys[0];
        const val = mcomp[mkey];
        if (typeof val !== "number") {
            return false;
        }
        return this.validateKey(mkey, "mfield");
    }
    isSComparisonValid(scomp) {
        if (typeof scomp !== "object" || scomp === null)
            return false;
        const keys = Object.keys(scomp);
        if (keys.length !== 1)
            return false;
        const skey = keys[0];
        const val = scomp[skey];
        if (typeof val !== "string")
            return false;
        return this.validateKey(skey, "sfield");
    }
    isNegationValid(notVal) {
        if (typeof notVal !== "object" ||
            notVal === null ||
            Array.isArray(notVal)) {
            return false;
        }
        const keys = Object.keys(notVal);
        if (keys.length !== 1) {
            return false;
        }
        return this.isFilterValid(notVal);
    }
    isSectionValid(section, filter) {
        const key = Object.keys(filter)[0];
        const content = filter[key];
        switch (key) {
            case "AND":
                return content.every((subFilter) => this.isSectionValid(section, subFilter));
            case "OR":
                return content.some((subFilter) => this.isSectionValid(section, subFilter));
            case "NOT":
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
                return true;
        }
    }
    handleMComp(section, comparison, op) {
        const queryKey = Object.keys(comparison)[0];
        const targetValue = comparison[queryKey];
        const field = queryKey.split("_")[1];
        let sectionValue = section[this.fieldToKey[field]];
        if (field === "year") {
            sectionValue =
                section.Section === "overall"
                    ? this.overallNumber
                    : parseInt(sectionValue, 10);
        }
        return op(sectionValue, targetValue);
    }
    handleSComp(section, comparison) {
        const queryKey = Object.keys(comparison)[0];
        const field = queryKey.split("_")[1];
        const inputString = comparison[queryKey];
        const sectionValue = String(section[this.fieldToKey[field]]);
        let regString = inputString.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        regString = "^" + regString.replace(/\*/g, ".*") + "$";
        const regex = new RegExp(regString);
        return regex.test(sectionValue);
    }
    transformToResult(section, columns) {
        const result = {};
        for (const columnKey of columns) {
            const field = columnKey.split("_")[1];
            const dataKey = this.fieldToKey[field];
            let value = section[dataKey];
            if (field === "year") {
                value =
                    section.Section === "overall"
                        ? this.overallNumber
                        : parseInt(value, 10);
            }
            if (field === "uuid") {
                value = String(value);
            }
            result[columnKey] = value;
        }
        return result;
    }
    isQueryValid(query) {
        const keys = Object.keys(query);
        if (keys.length !== 2 ||
            !keys.includes("WHERE") ||
            !keys.includes("OPTIONS")) {
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
    isFilterValid(filter) {
        if (typeof filter !== "object" ||
            filter === null ||
            Array.isArray(filter)) {
            return false;
        }
        const keys = Object.keys(filter);
        if (keys.length !== 1) {
            return false;
        }
        const key = keys[0];
        if (key === "AND" || key === "OR") {
            return this.isLogicComparisonValid(filter[key]);
        }
        else if (key === "GT" || key === "LT" || key === "EQ") {
            return this.isMComparisonValid(filter[key]);
        }
        else if (key === "IS") {
            return this.isSComparisonValid(filter[key]);
        }
        else if (key === "NOT") {
            return this.isNegationValid(filter[key]);
        }
        return false;
    }
    isOptionsValid(options) {
        if (typeof options !== "object" ||
            options === null ||
            Array.isArray(options)) {
            return false;
        }
        if (!Object.keys(options).includes("COLUMNS") ||
            !Array.isArray(options.COLUMNS) ||
            options.COLUMNS.length === 0) {
            return false;
        }
        for (const columnKey of options.COLUMNS) {
            if (!this.validateKey(columnKey)) {
                return false;
            }
        }
        if (Object.keys(options).includes("ORDER")) {
            const orderKey = options.ORDER;
            if (typeof orderKey !== "string" || !options.COLUMNS.includes(orderKey)) {
                return false;
            }
        }
        const validOptionsKeys = ["COLUMNS", "ORDER"];
        if (Object.keys(options).some((k) => !validOptionsKeys.includes(k))) {
            return false;
        }
        return true;
    }
    async performQuery(query) {
        this.currentQueryId = "";
        await this.initializeDatasets();
        if (typeof query !== "object" || query === null || Array.isArray(query)) {
            return Promise.reject(new IInsightFacade_1.InsightError("Query must be a non-null object"));
        }
        if (!this.isQueryValid(query)) {
            return Promise.reject(new IInsightFacade_1.InsightError("Invalid Query"));
        }
        const queryObj = query;
        const data = await this.loadDatasetFromDisk(this.currentQueryId);
        const filteredResults = data.filter((section) => {
            if (Object.keys(queryObj.WHERE).length === 0) {
                return true;
            }
            return this.isSectionValid(section, queryObj.WHERE);
        });
        if (filteredResults.length > this.resultLimit) {
            throw new IInsightFacade_1.ResultTooLargeError("Result too large (> 5000)");
        }
        const results = filteredResults.map((section) => {
            return this.transformToResult(section, queryObj.OPTIONS.COLUMNS);
        });
        if (queryObj.OPTIONS.ORDER) {
            const orderKey = queryObj.OPTIONS.ORDER;
            results.sort((a, b) => {
                if (a[orderKey] > b[orderKey])
                    return 1;
                if (a[orderKey] < b[orderKey])
                    return -1;
                return 0;
            });
        }
        return results;
    }
    async loadDatasetFromDisk(id) {
        try {
            const path = `./data/${id}.json`;
            const data = await fs.readJson(path);
            return data.rows;
        }
        catch (_err) {
            throw new IInsightFacade_1.InsightError(`Could not read dataset ${id} from disk`);
        }
    }
    async listDatasets() {
        await this.initializeDatasets();
        return Array.from(this.datasets.values());
    }
    async parseSections(zip) {
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
        const rooms = [];
        const indexFile = zip.file("index.htm");
        if (!indexFile) {
            throw new IInsightFacade_1.InsightError("Error: No index.htm file found in dataset");
        }
        const indexHtml = await indexFile.async("text");
        const buildings = parseBuildings(indexHtml);
        if (buildings.length === 0)
            return rooms;
        await Promise.all(buildings.map(async (building) => {
            const geo = await getGeoLocation(building.address);
            if (!geo || geo.error)
                return;
            const filePath = building.link.replace("./", "");
            const buildingFile = zip.file(filePath);
            if (!buildingFile)
                return;
            const buildingHtml = await buildingFile.async("text");
            const buildingRooms = parseRoomTable(buildingHtml, building, geo);
            rooms.push(...buildingRooms);
        }));
        return rooms;
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
    const buildingListTable = findBuildingTable(document);
    if (!buildingListTable)
        return buildings;
    const tbody = findNode(buildingListTable, "tbody");
    if (!tbody)
        return buildings;
    const rows = tbody.childNodes.filter((node) => node.nodeName === "tr");
    for (const row of rows) {
        const building = getBuildingInfo(row);
        if (building)
            buildings.push(building);
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
    if (node.nodeName === name) {
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
    if (node.nodeName === name)
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
    const cells = row.childNodes.filter((node) => node.nodeName === "td");
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
    return {
        link,
        shortname,
        fullname,
        address,
    };
}
function getTextContent(node) {
    if (node.nodeName === "#text")
        return node.value;
    if (node.childNodes) {
        return node.childNodes.map((child) => getTextContent(child)).join("");
    }
    return "";
}
function parseRoomTable(buildingHtml, building, geo) {
    const document = parse5.parse(buildingHtml);
    const rooms = [];
    const roomTable = findRoomTable(document);
    if (!roomTable)
        return rooms;
    const tbody = findNode(roomTable, "tbody");
    if (!tbody)
        return rooms;
    const rows = tbody.childNodes.filter((n) => n.nodeName === "tr");
    for (const row of rows) {
        const room = getRoomInfo(row, building, geo);
        if (room)
            rooms.push(room);
    }
    return rooms;
}
function findRoomTable(node) {
    if (node.nodeName === "table") {
        const tds = findAllNodes(node, "td");
        const hasRoomNumber = tds.some((td) => hasClass(td, "views-field-field-room-number"));
        if (hasRoomNumber)
            return node;
    }
    if (node.childNodes) {
        for (const child of node.childNodes) {
            const result = findRoomTable(child);
            if (result)
                return result;
        }
    }
    return null;
}
function getRoomInfo(row, building, geo) {
    const cells = row.childNodes.filter((n) => n.nodeName == "td");
    if (cells.length === 0)
        return null;
    let number = null;
    let href = null;
    let seats = null;
    let type = null;
    let furniture = null;
    for (const cell of cells) {
        if (hasClass(cell, "views-field-field-room-number")) {
            const anchor = findNode(cell, "a");
            number = anchor
                ? getTextContent(anchor).trim()
                : getTextContent(cell).trim();
            if (anchor && !href)
                href = getAttribute(anchor, "href");
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
            if (anchor)
                href = getAttribute(anchor, "href");
        }
    }
    if (!number ||
        seats === null ||
        isNaN(seats) ||
        !furniture ||
        !type ||
        !href) {
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
async function getGeoLocation(address) {
    try {
        const encodedAddress = encodeURIComponent(address);
        const url = "http://cs310.students.cs.ubc.ca:11316/api/v1/project_team059/${encodedAddress}";
        const response = await fetch(url);
        if (!response.ok)
            return null;
        const data = (await response.json());
        if (data.error)
            return { lat: 0, lon: 0, error: data.error };
        if (typeof data.lat !== "number" || typeof data.lon !== "number")
            return null;
        return { lat: data.lat, lon: data.lon };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=InsightFacade.js.map