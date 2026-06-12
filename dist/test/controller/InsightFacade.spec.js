"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jszip_1 = __importDefault(require("jszip"));
const IInsightFacade_1 = require("../../src/controller/IInsightFacade");
const InsightFacade_1 = __importDefault(require("../../src/controller/InsightFacade"));
const TestUtil_1 = require("../TestUtil");
const chai_1 = require("chai");
const chai_as_promised_1 = __importDefault(require("chai-as-promised"));
const mocha_1 = require("mocha");
(0, chai_1.use)(chai_as_promised_1.default);
describe("InsightFacade", function () {
    let facade;
    let sections;
    before(async function () {
        sections = await (0, TestUtil_1.getContentFromArchives)("pair.zip");
        await (0, TestUtil_1.clearDisk)();
    });
    (0, mocha_1.beforeEach)(async function () {
        await (0, TestUtil_1.clearDisk)();
        facade = new InsightFacade_1.default();
    });
    describe("AddDataset", function () {
        it("should reject with a blank dataset id", async function () {
            try {
                await facade.addDataset("   ", sections, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a dataset id with an underscore", async function () {
            try {
                await facade.addDataset("invalid_id", sections, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a duplicate dataset id", async function () {
            const zip = new jszip_1.default();
            const course1 = {
                result: [
                    {
                        id: "101",
                        Course: "CPSC 101",
                        Title: "Intro to CS",
                        Professor: "Smith",
                        Subject: "CPSC",
                        Year: 2020,
                        Avg: 83,
                        Pass: 167,
                        Fail: 21,
                        Audit: 5,
                    },
                ],
            };
            const courses = zip.folder("courses");
            courses?.file("course1.txt", JSON.stringify(course1));
            const content = await zip.generateAsync({ type: "base64" });
            await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
            try {
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with invalid content", async function () {
            try {
                await facade.addDataset("validId", null, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject dataset with no course files", async function () {
            try {
                const zip = new jszip_1.default();
                zip.folder("noCoursesHere");
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should ignore non JSON course files", async function () {
            try {
                const zip = new jszip_1.default();
                const courses = zip.folder("courses");
                courses?.file("course1.txt");
                courses?.file("course2.txt");
                courses?.file("course3.txt");
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should skip courses without result key", async function () {
            try {
                const zip = new jszip_1.default();
                const courseData = { data: [] };
                const courses = zip.folder("courses");
                courses?.file("course1.txt", JSON.stringify(courseData));
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should skip courses where result is not an array", async function () {
            try {
                const zip = new jszip_1.default();
                const course1 = {
                    result: "string",
                };
                const course2 = {
                    result: 123,
                };
                const courses = zip.folder("courses");
                courses?.file("course1.txt", JSON.stringify(course1));
                courses?.file("course2.txt", JSON.stringify(course2));
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should skip sections that are missing required fields", async function () {
            try {
                const zip = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                        },
                    ],
                };
                const courses = zip.folder("courses");
                courses?.file("course1.txt", JSON.stringify(course1));
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should add valid dataset", async function () {
            try {
                const zip = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                            Audit: 5,
                        },
                    ],
                };
                const course2 = {
                    result: [
                        {
                            id: "222",
                            Course: "COGS 222",
                            Title: "Cognitive Systems",
                            Professor: "Johnson",
                            Subject: "COGS",
                            Year: 2021,
                            Avg: 78,
                            Pass: 120,
                            Fail: 29,
                            Audit: 11,
                        },
                    ],
                };
                const courses = zip.folder("courses");
                courses?.file("course1.txt", JSON.stringify(course1));
                courses?.file("course2.txt", JSON.stringify(course2));
                const content = await zip.generateAsync({ type: "base64" });
                const datasetIds = await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                (0, chai_1.expect)(datasetIds).to.deep.equal(["validId"]);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
        it("should add multiple valid datasets", async function () {
            try {
                const zip1 = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                            Audit: 5,
                        },
                    ],
                };
                const courses1 = zip1.folder("courses");
                courses1?.file("course1.txt", JSON.stringify(course1));
                const content1 = await zip1.generateAsync({ type: "base64" });
                const datasetIds1 = await facade.addDataset("dataset1", content1, IInsightFacade_1.InsightDatasetKind.Sections);
                (0, chai_1.expect)(datasetIds1).to.deep.equal(["dataset1"]);
                const zip2 = new jszip_1.default();
                const course2 = {
                    result: [
                        {
                            id: "222",
                            Course: "COGS 222",
                            Title: "Cognitive Systems",
                            Professor: "Johnson",
                            Subject: "COGS",
                            Year: 2021,
                            Avg: 78,
                            Pass: 120,
                            Fail: 29,
                            Audit: 11,
                        },
                    ],
                };
                const courses2 = zip2.folder("courses");
                courses2?.file("course2.txt", JSON.stringify(course2));
                const content2 = await zip2.generateAsync({ type: "base64" });
                const datasetIds2 = await facade.addDataset("dataset2", content2, IInsightFacade_1.InsightDatasetKind.Sections);
                (0, chai_1.expect)(datasetIds2).to.have.members(["dataset1", "dataset2"]);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
        it("should load persisted dataset from disk", async function () {
            try {
                const zip = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                            Audit: 5,
                        },
                    ],
                };
                const courses = zip.folder("courses");
                courses?.file("course1.txt", JSON.stringify(course1));
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("validId", content, IInsightFacade_1.InsightDatasetKind.Sections);
                facade = new InsightFacade_1.default();
                const datasetList = await facade.listDatasets();
                (0, chai_1.expect)(datasetList).to.have.lengthOf(1);
                (0, chai_1.expect)(datasetList).to.deep.include.members([
                    { id: "validId", kind: IInsightFacade_1.InsightDatasetKind.Sections, numRows: 1 },
                ]);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
        it("should reject a room dataset missing index.htm file", async function () {
            try {
                const zip = new jszip_1.default();
                zip.folder("campus");
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("rooms", content, IInsightFacade_1.InsightDatasetKind.Rooms);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
                (0, chai_1.expect)(err).to.have.property("message").that.includes("index.htm");
            }
        });
        it("should reject a room dataset with no building table", async function () {
            try {
                const zip = new jszip_1.default();
                const indexHtml = `
          <html>
            <body>
              <table>
                <tbody>
                  <tr>
                    <td>empty classes, no buildings</td>
                  </tr>
                </tbody>
              </table>
            </body>
          </html>
        `;
                zip.file("index.htm", indexHtml);
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("rooms", content, IInsightFacade_1.InsightDatasetKind.Rooms);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
                (0, chai_1.expect)(err)
                    .to.have.property("message")
                    .that.includes("No valid rows found");
            }
        });
        it("should reject rooms dataset with missing building files", async function () {
            try {
                const zip = new jszip_1.default();
                const indexHtml = `
          <html><body>
            <table><tbody>
              <tr>
                <td class="views-field views-field-title">
                  <a href="./campus/discover/buildings-and-classrooms/AAC.htm">Acute Care Unit</a>
                </td>
                <td class="views-field views-field-field-building-code">AAC</td>  
                <td class="views-field views-field-field-building-address">2211 Wesbrook Mall</td>
              </tr>
            </tbody></table>
          </body></html>
        `;
                zip.file("index.htm", indexHtml);
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("rooms", content, IInsightFacade_1.InsightDatasetKind.Rooms);
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
                (0, chai_1.expect)(err)
                    .to.have.property("message")
                    .that.includes("No valid rows found");
            }
        });
    });
    describe("AddDataset_Rooms", function () {
        let rooms;
        before(async function () {
            rooms = await (0, TestUtil_1.getContentFromArchives)("campus.zip");
        });
        it("should add a valid rooms dataset", async function () {
            const result = await facade.addDataset("rooms", rooms, IInsightFacade_1.InsightDatasetKind.Rooms);
            (0, chai_1.expect)(result).to.deep.equal(["rooms"]);
        });
    });
    describe("RemoveDataset", function () {
        it("should reject with a blank dataset id", async function () {
            try {
                await facade.removeDataset("   ");
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a dataset id with an underscore", async function () {
            try {
                await facade.removeDataset("invalid_id");
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a non-existent dataset id", async function () {
            try {
                await facade.removeDataset("nonExistentId");
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.NotFoundError);
            }
        });
        it("should remove an existing dataset", async function () {
            try {
                const zip1 = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                            Audit: 5,
                        },
                    ],
                };
                const courses1 = zip1.folder("courses");
                courses1?.file("course1.txt", JSON.stringify(course1));
                const content1 = await zip1.generateAsync({ type: "base64" });
                await facade.addDataset("dataset1", content1, IInsightFacade_1.InsightDatasetKind.Sections);
                const zip2 = new jszip_1.default();
                const course2 = {
                    result: [
                        {
                            id: "222",
                            Course: "COGS 222",
                            Title: "Cognitive Systems",
                            Professor: "Johnson",
                            Subject: "COGS",
                            Year: 2021,
                            Avg: 78,
                            Pass: 120,
                            Fail: 29,
                            Audit: 11,
                        },
                    ],
                };
                const courses2 = zip2.folder("courses");
                courses2?.file("course2.txt", JSON.stringify(course2));
                const content2 = await zip2.generateAsync({ type: "base64" });
                await facade.addDataset("dataset2", content2, IInsightFacade_1.InsightDatasetKind.Sections);
                const removedId = await facade.removeDataset("dataset1");
                (0, chai_1.expect)(removedId).to.equal("dataset1");
                const datasetList = await facade.listDatasets();
                (0, chai_1.expect)(datasetList).to.have.lengthOf(1);
                (0, chai_1.expect)(datasetList[0].id).to.equal("dataset2");
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
    });
    describe("ListDataset", function () {
        it("should show empty list", async function () {
            try {
                const datasets = await facade.listDatasets();
                (0, chai_1.expect)(datasets).to.deep.equal([]);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
        it("should show multiple datasets", async function () {
            try {
                const zip1 = new jszip_1.default();
                const course1 = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 83,
                            Pass: 167,
                            Fail: 21,
                            Audit: 5,
                        },
                    ],
                };
                const courses1 = zip1.folder("courses");
                courses1?.file("course1.txt", JSON.stringify(course1));
                const content1 = await zip1.generateAsync({ type: "base64" });
                await facade.addDataset("dataset1", content1, IInsightFacade_1.InsightDatasetKind.Sections);
                const zip2 = new jszip_1.default();
                const course2 = {
                    result: [
                        {
                            id: "222",
                            Course: "COGS 222",
                            Title: "Cognitive Systems",
                            Professor: "Johnson",
                            Subject: "COGS",
                            Year: 2021,
                            Avg: 78,
                            Pass: 120,
                            Fail: 29,
                            Audit: 11,
                        },
                    ],
                };
                const courses2 = zip2.folder("courses");
                courses2?.file("course2.txt", JSON.stringify(course2));
                const content2 = await zip2.generateAsync({ type: "base64" });
                await facade.addDataset("dataset2", content2, IInsightFacade_1.InsightDatasetKind.Sections);
                const datasetList = await facade.listDatasets();
                (0, chai_1.expect)(datasetList).to.have.lengthOf(2);
                (0, chai_1.expect)(datasetList).to.deep.include.members([
                    { id: "dataset1", kind: IInsightFacade_1.InsightDatasetKind.Sections, numRows: 1 },
                    { id: "dataset2", kind: IInsightFacade_1.InsightDatasetKind.Sections, numRows: 1 },
                ]);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
    });
    describe("PerformQuery", function () {
        async function checkQuery() {
            if (!this.test) {
                throw new Error("Invalid call to checkQuery." +
                    "Usage: 'checkQuery' must be passed as the second parameter of Mocha's it(..) function." +
                    "Do not invoke the function directly.");
            }
            const { input, expected, errorExpected } = await (0, TestUtil_1.loadTestQuery)(this.test.title);
            let result = [];
            try {
                result = await facade.performQuery(input);
            }
            catch (err) {
                if (!errorExpected) {
                    chai_1.expect.fail(`performQuery threw unexpected error: ${err}`);
                }
                if (expected === "InsightError") {
                    (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
                }
                else if (expected === "ResultTooLargeError") {
                    (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.ResultTooLargeError);
                }
                return;
            }
            if (errorExpected) {
                chai_1.expect.fail(`performQuery resolved when it should have rejected with ${expected}`);
            }
            (0, chai_1.expect)(result).to.deep.equal(expected);
        }
        before(async function () {
            await (0, TestUtil_1.clearDisk)();
            facade = new InsightFacade_1.default();
            const loadDatasetPromises = [
                facade.addDataset("sections", sections, IInsightFacade_1.InsightDatasetKind.Sections),
            ];
            try {
                await Promise.all(loadDatasetPromises);
            }
            catch (err) {
                throw new Error(`In PerformQuery Before hook, dataset(s) failed to be added. \n${err}`);
            }
        });
        (0, mocha_1.beforeEach)(async function () {
            facade = new InsightFacade_1.default();
        });
        after(async function () {
            await (0, TestUtil_1.clearDisk)();
        });
        it("[valid/simple.json] SELECT dept, avg WHERE avg > 97", checkQuery);
        it("[invalid/invalid.json] Query missing WHERE", checkQuery);
        it("should reject with a non-object query", async function () {
            try {
                await facade.performQuery("query");
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a query missing WHERE", async function () {
            try {
                await facade.performQuery({
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject with a query with extra keys", async function () {
            try {
                await facade.performQuery({
                    WHERE: {},
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                    },
                    EXTRA: "extraValue",
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject non-object WHERE", async function () {
            try {
                await facade.performQuery({
                    WHERE: "string",
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should accept an empty WHERE", async function () {
            try {
                await facade.performQuery({
                    WHERE: {},
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(Error);
            }
        });
        it("should reject WHERE with more than one filter", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: { sections_avg: 80 },
                        LT: { sections_avg: 90 },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject non-object filter value", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        NOT: "string",
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject filter that is not exactly one key", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        AND: [
                            {
                                GT: { sections_avg: 80 },
                                LT: { sections_avg: 90 },
                            },
                        ],
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject AND with non-array value", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        AND: "string",
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_avg"],
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject OR with empty array", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        OR: [],
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_avg"],
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject invalid filter type", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        ET: {
                            sections_avg: 80,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject Comparison with non-object content", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: "string",
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject Comparison that is not exactly one key", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sections_avg: 80,
                            sections_pass: 100,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject MComparison with non-number value", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sections_avg: "string",
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject Comparison with invalid key format", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sectionsavg: 80,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err);
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject invalid MComparison keys", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            invalid_key: 86,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["sections_dept", "sections_avg"],
                        ORDER: "sections_avg",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should reject non-object OPTIONS", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sections_avg: 97,
                        },
                    },
                    OPTIONS: "string",
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("Should reject OPTIONS with extra keys", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sections_avg: 97,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: [],
                        OPTIONS: "",
                        EXTRA: [],
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("Should reject query with multiple IDs", async function () {
            try {
                await facade.performQuery({
                    WHERE: {
                        GT: {
                            sections_avg: 97,
                        },
                    },
                    OPTIONS: {
                        COLUMNS: ["ubc_dept", "uofa_id", "uoft_avg"],
                        ORDER: "ubc_dept",
                    },
                });
                chai_1.expect.fail("Should have thrown!");
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.an.instanceOf(IInsightFacade_1.InsightError);
            }
        });
        it("should filter sections with wildcard at start", async function () {
            const zip = new jszip_1.default();
            const course = {
                result: [
                    {
                        id: "101",
                        Course: "CPSC 101",
                        Title: "Intro to CS",
                        Professor: "Smith",
                        Subject: "CPSC",
                        Year: 2020,
                        Avg: 95,
                        Pass: 173,
                        Fail: 19,
                        Audit: 5,
                    },
                    {
                        id: "321",
                        Course: "CPSC 321",
                        Title: "Counting down in CS",
                        Professor: "Downlow",
                        Subject: "CPSC",
                        Year: 2013,
                        Avg: 89,
                        Pass: 321,
                        Fail: 123,
                        Audit: 10,
                    },
                ],
            };
            const courses = zip.folder("courses");
            courses?.file("CPSC_courses.txt", JSON.stringify(course));
            const content = await zip.generateAsync({ type: "base64" });
            await facade.addDataset("ubc", content, IInsightFacade_1.InsightDatasetKind.Sections);
            const result = await facade.performQuery({
                WHERE: {
                    IS: { ubc_dept: "*PSC" },
                },
                OPTIONS: {
                    COLUMNS: ["ubc_dept"],
                },
            });
            (0, chai_1.expect)(result).to.deep.equal([
                { ubc_dept: "CPSC" },
                { ubc_dept: "CPSC" },
            ]);
        });
        it("should filter sections with wildcard at end", async function () {
            const zip = new jszip_1.default();
            const course = {
                result: [
                    {
                        id: "101",
                        Course: "CPSC 101",
                        Title: "Intro to CS",
                        Professor: "Smith",
                        Subject: "CPSC",
                        Year: 2020,
                        Avg: 95,
                        Pass: 173,
                        Fail: 19,
                        Audit: 5,
                    },
                    {
                        id: "222",
                        Course: "COGS 222",
                        Title: "Cognitive Systems",
                        Professor: "Johnson",
                        Subject: "COGS",
                        Year: 2021,
                        Avg: 78,
                        Pass: 120,
                        Fail: 29,
                        Audit: 11,
                    },
                ],
            };
            const courses = zip.folder("courses");
            courses?.file("CPSC_courses.txt", JSON.stringify(course));
            const content = await zip.generateAsync({ type: "base64" });
            await facade.addDataset("ubc", content, IInsightFacade_1.InsightDatasetKind.Sections);
            const result = await facade.performQuery({
                WHERE: {
                    IS: { ubc_dept: "C*" },
                },
                OPTIONS: {
                    COLUMNS: ["ubc_dept"],
                },
            });
            (0, chai_1.expect)(result).to.deep.equal([
                { ubc_dept: "CPSC" },
                { ubc_dept: "COGS" },
            ]);
        });
        it("should pass with valid query", async function () {
            try {
                const zip = new jszip_1.default();
                const course = {
                    result: [
                        {
                            id: "101",
                            Course: "CPSC 101",
                            Title: "Intro to CS",
                            Professor: "Smith",
                            Subject: "CPSC",
                            Year: 2020,
                            Avg: 95,
                            Pass: 173,
                            Fail: 19,
                            Audit: 5,
                        },
                    ],
                };
                const courses = zip.folder("courses");
                courses?.file("CPSC101.txt", JSON.stringify(course));
                const content = await zip.generateAsync({ type: "base64" });
                await facade.addDataset("ubc", content, IInsightFacade_1.InsightDatasetKind.Sections);
                const result = await facade.performQuery({
                    WHERE: {
                        OR: [
                            {
                                AND: [
                                    {
                                        GT: {
                                            ubc_avg: 90,
                                        },
                                    },
                                    {
                                        IS: {
                                            ubc_dept: "adhe",
                                        },
                                    },
                                ],
                            },
                            {
                                EQ: {
                                    ubc_avg: 95,
                                },
                            },
                        ],
                    },
                    OPTIONS: {
                        COLUMNS: ["ubc_dept", "ubc_id", "ubc_avg"],
                        ORDER: "ubc_avg",
                    },
                });
                (0, chai_1.expect)(result).to.be.an.instanceOf(Array);
            }
            catch (err) {
                chai_1.expect.fail("Should not have thrown!");
            }
        });
    });
});
//# sourceMappingURL=InsightFacade.spec.js.map