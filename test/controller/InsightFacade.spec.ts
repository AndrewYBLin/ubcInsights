import JSZip from "jszip";
import {
  InsightError,
  IInsightFacade,
  InsightDatasetKind,
  InsightResult,
  NotFoundError,
  ResultTooLargeError,
} from "../../src/controller/IInsightFacade";
import InsightFacade from "../../src/controller/InsightFacade";
import { clearDisk, getContentFromArchives, loadTestQuery } from "../TestUtil";

import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { beforeEach } from "mocha";

use(chaiAsPromised);

export interface ITestQuery {
  title?: string;
  input: unknown;
  errorExpected: boolean;
  expected: any;
}

describe("InsightFacade", function () {
  let facade: IInsightFacade;

  // Declare datasets used in tests. You should add more datasets like this!
  let sections: string;

  before(async function () {
    // This block runs once and loads the datasets.
    sections = await getContentFromArchives("pair.zip");

    // Just in case there is anything hanging around from a previous run of the test suite
    await clearDisk();
  });

  beforeEach(async function () {
    await clearDisk();
    facade = new InsightFacade();
  });

  describe("AddDataset", function () {
    it("should reject with a blank dataset id", async function () {
      try {
        await facade.addDataset("   ", sections, InsightDatasetKind.Sections);
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject with a dataset id with an underscore", async function () {
      try {
        await facade.addDataset(
          "invalid_id",
          sections,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject with a duplicate dataset id", async function () {
      const zip = new JSZip();
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
      // add dataset the first time
      await facade.addDataset("validId", content, InsightDatasetKind.Sections);
      try {
        // add dataset with same id the second time
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject with invalid content", async function () {
      try {
        await facade.addDataset(
          "validId",
          null as unknown as string,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject dataset with no course files", async function () {
      try {
        const zip = new JSZip();
        zip.folder("noCoursesHere");

        const content = await zip.generateAsync({ type: "base64" });
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should ignore non JSON course files", async function () {
      try {
        const zip = new JSZip();
        const courses = zip.folder("courses");
        courses?.file("course1.txt");
        courses?.file("course2.txt");
        courses?.file("course3.txt");

        const content = await zip.generateAsync({ type: "base64" });
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should skip courses without result key", async function () {
      try {
        const zip = new JSZip();
        const courseData = { data: [] };
        const courses = zip.folder("courses");
        courses?.file("course1.txt", JSON.stringify(courseData));

        const content = await zip.generateAsync({ type: "base64" });
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should skip courses where result is not an array", async function () {
      try {
        const zip = new JSZip();
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
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should skip sections that are missing required fields", async function () {
      try {
        const zip = new JSZip();
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
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should add valid dataset", async function () {
      try {
        const zip = new JSZip();
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
        const datasetIds = await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );
        expect(datasetIds).to.deep.equal(["validId"]);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });

    it("should add multiple valid datasets", async function () {
      try {
        // add first dataset
        const zip1 = new JSZip();
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
        const datasetIds1 = await facade.addDataset(
          "dataset1",
          content1,
          InsightDatasetKind.Sections,
        );
        expect(datasetIds1).to.deep.equal(["dataset1"]);

        // add second dataset
        const zip2 = new JSZip();
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
        const datasetIds2 = await facade.addDataset(
          "dataset2",
          content2,
          InsightDatasetKind.Sections,
        );
        expect(datasetIds2).to.have.members(["dataset1", "dataset2"]);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });

    it("should load persisted dataset from disk", async function () {
      try {
        const zip = new JSZip();
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
        await facade.addDataset(
          "validId",
          content,
          InsightDatasetKind.Sections,
        );

        // simulate restart
        facade = new InsightFacade();

        const datasetList = await facade.listDatasets();
        expect(datasetList).to.have.lengthOf(1);
        expect(datasetList).to.deep.include.members([
          { id: "validId", kind: InsightDatasetKind.Sections, numRows: 1 },
        ]);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });

    it("should reject a room dataset missing index.htm file", async function () {
      try {
        const zip = new JSZip();
        zip.folder("campus");
        const content = await zip.generateAsync({ type: "base64" });

        await facade.addDataset("rooms", content, InsightDatasetKind.Rooms);
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
        expect(err).to.have.property("message").that.includes("index.htm");
      }
    });

    it("should reject a room dataset with no building table", async function () {
      try {
        const zip = new JSZip();

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
        await facade.addDataset("rooms", content, InsightDatasetKind.Rooms);
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
        expect(err)
          .to.have.property("message")
          .that.includes("No valid rows found");
      }
    });

    it("should reject rooms dataset with missing building files", async function () {
      try {
        const zip = new JSZip();
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
        await facade.addDataset("rooms", content, InsightDatasetKind.Rooms);
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
        expect(err)
          .to.have.property("message")
          .that.includes("No valid rows found");
      }
    });
  });

  describe("AddDataset_Rooms", function () {
    let rooms: string;

    before(async function () {
      rooms = await getContentFromArchives("campus.zip");
    });

    it("should add a valid rooms dataset", async function () {
      const result = await facade.addDataset(
        "rooms",
        rooms,
        InsightDatasetKind.Rooms,
      );
      expect(result).to.deep.equal(["rooms"]);
    });
  });

  describe("RemoveDataset", function () {
    it("should reject with a blank dataset id", async function () {
      try {
        await facade.removeDataset("   ");
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject with a dataset id with an underscore", async function () {
      try {
        await facade.removeDataset("invalid_id");
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    it("should reject with a non-existent dataset id", async function () {
      try {
        await facade.removeDataset("nonExistentId");
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(NotFoundError);
      }
    });

    it("should remove an existing dataset", async function () {
      try {
        const zip1 = new JSZip();
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
        await facade.addDataset(
          "dataset1",
          content1,
          InsightDatasetKind.Sections,
        );

        const zip2 = new JSZip();
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
        await facade.addDataset(
          "dataset2",
          content2,
          InsightDatasetKind.Sections,
        );

        const removedId = await facade.removeDataset("dataset1");
        expect(removedId).to.equal("dataset1");
        const datasetList = await facade.listDatasets();
        expect(datasetList).to.have.lengthOf(1);
        expect(datasetList[0].id).to.equal("dataset2");
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });
  });

  describe("ListDataset", function () {
    it("should show empty list", async function () {
      try {
        const datasets = await facade.listDatasets();
        expect(datasets).to.deep.equal([]);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });

    it("should show multiple datasets", async function () {
      try {
        const zip1 = new JSZip();
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
        await facade.addDataset(
          "dataset1",
          content1,
          InsightDatasetKind.Sections,
        );

        const zip2 = new JSZip();
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
        await facade.addDataset(
          "dataset2",
          content2,
          InsightDatasetKind.Sections,
        );

        const datasetList = await facade.listDatasets();
        expect(datasetList).to.have.lengthOf(2);
        expect(datasetList).to.deep.include.members([
          { id: "dataset1", kind: InsightDatasetKind.Sections, numRows: 1 },
          { id: "dataset2", kind: InsightDatasetKind.Sections, numRows: 1 },
        ]);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });
  });

  describe("PerformQuery", function () {
    /**
     * Loads the TestQuery specified in the test name and asserts the behaviour of performQuery.
     *
     * Note: the 'this' parameter is automatically set by Mocha and contains information about the test.
     */
    async function checkQuery(this: Mocha.Context): Promise<void> {
      if (!this.test) {
        throw new Error(
          "Invalid call to checkQuery." +
            "Usage: 'checkQuery' must be passed as the second parameter of Mocha's it(..) function." +
            "Do not invoke the function directly.",
        );
      }
      // Destructuring assignment to reduce property accesses
      const { input, expected, errorExpected } = await loadTestQuery(
        this.test.title,
      );
      let result: InsightResult[] = []; // dummy value before being reassigned
      try {
        result = await facade.performQuery(input);
      } catch (err) {
        if (!errorExpected) {
          expect.fail(`performQuery threw unexpected error: ${err}`);
        }
        // TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
        // to determine what to put here :)
        if (expected === "InsightError") {
          expect(err).to.be.an.instanceOf(InsightError);
        } else if (expected === "ResultTooLargeError") {
          expect(err).to.be.an.instanceOf(ResultTooLargeError);
        }
        return;
        // return expect.fail("Write your assertion(s) here.");
      }
      if (errorExpected) {
        expect.fail(
          `performQuery resolved when it should have rejected with ${expected}`,
        );
      }
      // TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
      // to determine what to put here :)
      expect(result).to.deep.equal(expected);
      //return expect.fail("Write your assertion(s) here.");
    }

    before(async function () {
      await clearDisk();
      facade = new InsightFacade();

      // Add the datasets to InsightFacade once.
      // Will *fail* if there is a problem reading ANY dataset.
      const loadDatasetPromises: Promise<string[]>[] = [
        facade.addDataset("sections", sections, InsightDatasetKind.Sections),
      ];

      try {
        await Promise.all(loadDatasetPromises);
      } catch (err) {
        throw new Error(
          `In PerformQuery Before hook, dataset(s) failed to be added. \n${err}`,
        );
      }
    });

    beforeEach(async function () {
      facade = new InsightFacade();
    });

    after(async function () {
      await clearDisk();
    });

    // Examples demonstrating how to test performQuery using the JSON Test Queries.
    // The relative path to the query file must be given in square brackets.
    it("[valid/simple.json] SELECT dept, avg WHERE avg > 97", checkQuery);
    it("[invalid/invalid.json] Query missing WHERE", checkQuery);

    // validateQuery tests
    it("should reject with a non-object query", async function () {
      try {
        await facade.performQuery("query");
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // validateWhere tests
    it("should reject non-object WHERE", async function () {
      try {
        await facade.performQuery({
          WHERE: "string",
          OPTIONS: {
            COLUMNS: ["sections_dept", "sections_avg"],
            ORDER: "sections_avg",
          },
        });
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(Error);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // validateFilter tests
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // validateComparison tests
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // validateKey tests
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err);
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // validateOptions tests
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // getDatasetID test
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
        expect.fail("Should have thrown!");
      } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
      }
    });

    // applyComparison tests
    it("should filter sections with wildcard at start", async function () {
      const zip = new JSZip();
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
      await facade.addDataset("ubc", content, InsightDatasetKind.Sections);

      const result = await facade.performQuery({
        WHERE: {
          IS: { ubc_dept: "*PSC" },
        },
        OPTIONS: {
          COLUMNS: ["ubc_dept"],
        },
      });
      expect(result).to.deep.equal([
        { ubc_dept: "CPSC" },
        { ubc_dept: "CPSC" },
      ]);
    });

    it("should filter sections with wildcard at end", async function () {
      const zip = new JSZip();
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
      await facade.addDataset("ubc", content, InsightDatasetKind.Sections);

      const result = await facade.performQuery({
        WHERE: {
          IS: { ubc_dept: "C*" },
        },
        OPTIONS: {
          COLUMNS: ["ubc_dept"],
        },
      });
      expect(result).to.deep.equal([
        { ubc_dept: "CPSC" },
        { ubc_dept: "COGS" },
      ]);
    });

    // passing case with complex example
    it("should pass with valid query", async function () {
      try {
        const zip = new JSZip();
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
        await facade.addDataset("ubc", content, InsightDatasetKind.Sections);

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
        expect(result).to.be.an.instanceOf(Array);
      } catch (err) {
        expect.fail("Should not have thrown!");
      }
    });
  });
});
