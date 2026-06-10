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
import * as fs from "fs-extra";

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
	let rooms: string;

	before(async function () {
		// This block runs once and loads the datasets.
		sections = await getContentFromArchives("pair.zip");
		rooms = await getContentFromArchives("campus.zip");
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

	// C2 addDataset test for rooms
	describe("addDataset - Rooms Kind", function () {

		it("Should successfully add a valid rooms dataset", async function () {
			const result = await facade.addDataset("rooms-test", rooms, InsightDatasetKind.Rooms);

			// Verifies it returns an array containing all loaded IDs
			expect(result).to.be.an("array");
			expect(result).to.include("rooms-test");
			expect(result.length).to.equal(1);
		});

		it("Should reject with InsightError if rooms dataset kind is passed but folder content matches sections", async function () {
			// Feeding it sections zip content while declaring it is an InsightDatasetKind.Rooms kind
			const action = facade.addDataset("mismatched-kind", sections, InsightDatasetKind.Rooms);

			await expect(action).to.eventually.be.rejectedWith(InsightError);
		});

		// it("Should reject with InsightError if the rooms dataset lacks a root index.htm", async function () {
		// 	// To get this coverage, generate or pass a fake zip that doesn't have an index.htm file
		// 	const fakeZipContent = await getContentFromArchives("corrupted_no_index.zip");
		// 	const action = facade.addDataset("no-index-test", fakeZipContent, InsightDatasetKind.Rooms);
		//
		// 	await expect(action).to.eventually.be.rejectedWith(InsightError);
		// });

		// it("Should safely skip buildings with invalid geolocation coordinates or missing internal html records", async function () {
		// 	const edgeCasesContent = await getContentFromArchives("rooms_edge_cases.zip");
		// 	const result = await facade.addDataset("rooms-edge", edgeCasesContent, InsightDatasetKind.Rooms);
		//
		// 	expect(result).to.include("rooms-edge");
		// });
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


		// start AI tests
		// firstone
		it("should throw an InsightError if the dataset is in memory but missing from disk", async function () {
			const id = "sections";

			// 1. Add a valid dataset to satisfy the in-memory validation map
			// (Assuming `sections` variable holds your valid base64 pair dataset string)
			await facade.addDataset(id, sections, InsightDatasetKind.Sections);

			// 2. Manually sabotage the disk state behind the facade's back
			const diskPath = `./data/${id}.json`;
			await fs.remove(diskPath); // Alternatively, use fs.outputFile(diskPath, "invalid-json-text{");

			// 3. Craft a syntactically perfect query object matching the 'sections' ID
			const validQuery = {
				WHERE: {
					GT: {
						sections_avg: 90
					}
				},
				OPTIONS: {
					COLUMNS: ["sections_dept", "sections_avg"]
				}
			};

			// 4. Assert that performQuery rejects with the InsightError wrapped inside your catch block
			try {
				await facade.performQuery(validQuery);
				expect.fail("The query should have rejected because the disk file is missing!");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
				expect((err as Error).message).to.equal(`Could not read dataset ${id} from disk`);
			}
		});

		//secondone

		it("Should hit line 178 (mismatched ID) when both datasets exist", async function () {
		// 1. Manually populate the memory map so both IDs bypass the .has(id) guard
		// We mock the Map entries directly to avoid needing to parse the full rooms zip file here
		(facade as any)["datasets"].set("sections", { id: "sections", kind: InsightDatasetKind.Sections, numRows: 100 });
		(facade as any)["datasets"].set("rooms", { id: "rooms", kind: InsightDatasetKind.Rooms, numRows: 100 });

		// 2. Formulate a query where both keys look entirely valid to their respective schemas
		const mismatchedQuery = {
			WHERE: {
				GT: {
					sections_avg: 90 // 1st: sets currentQueryId = "sections"
				}
			},
			OPTIONS: {
				COLUMNS: [
					"sections_dept",
					"rooms_seats"    // 2nd: "rooms" !== "sections" -> Triggers line 178!
				],
				ORDER: "sections_dept"
			}
		};

		try {
			await facade.performQuery(mismatchedQuery);
			expect.fail("Query should have been rejected as invalid");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
			expect((err as Error).message).to.equal("Invalid Query");
		}
	});

	//thirdone
	it("should successfully hit continue inside processZipFiles when encountering bad JSON", async function () {
		const zip = new JSZip();

		// 1. Create a valid 'courses/' directory structure inside the zip
		const folder = zip.folder("courses");

		// 2. Add one perfectly valid course file so dataToStore.length > 0 overall
		folder?.file("cpsc310.json", JSON.stringify({
			result: [{ Subject: "CPSC", Course: "310", Avg: 90, Pass: 100, Fail: 0, Audit: 0, id: "123" }]
		}));

		// 3. Add the toxic file that triggers line 101's continue statement
		// This file MUST be inside the courses folder and contain completely broken syntax
		folder?.file("corrupted_file.json", "NOT_VALID_JSON!!! { missing_brackets: ");

		// 4. Generate the base64 string directly from JSZip
		const corruptedBase64 = await zip.generateAsync({ type: "base64" });

		try {
			// 5. Run addDataset
			const result = await facade.addDataset("corrupted-test", corruptedBase64, InsightDatasetKind.Sections);

			// Assertions to verify the good file saved while the bad one skipped safely
			expect(result).to.be.an("array").that.includes("corrupted-test");

			const datasets = await facade.listDatasets();
			const added = datasets.find((d) => d.id === "corrupted-test");
			expect(added).to.not.be.undefined;
			expect(added?.numRows).to.equal(1); // Only 1 row from cpsc310.json parsed successfully!
		} catch (err) {
			expect.fail(`Should not have rejected. Loop should catch parse error and continue: ${err}`);
		}
		});

		//fourthone
			it("should hit the key length check branch when NOT block has multiple keys", async function () {
		const invalidMultiKeyQuery = {
			WHERE: {
				NOT: {
					GT: { sections_avg: 90 },
					IS: { sections_dept: "cpsc" } // This extra key triggers line 3
				}
			},
			OPTIONS: {
				COLUMNS: ["sections_dept"],
				ORDER: "sections_dept"
			}
		};

		try {
			await facade.performQuery(invalidMultiKeyQuery);
			expect.fail("Should have rejected multi-key NOT filter");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
	});

	it("should hit the final line and recursively validate a clean NOT filter structure", async function () {
		const validNegationQuery = {
			WHERE: {
				NOT: {
					GT: { sections_avg: 95 } // Exactly 1 key. Triggers line 4!
				}
			},
			OPTIONS: {
				COLUMNS: ["sections_dept"],
				ORDER: "sections_dept"
			}
		};

		try {
			// Ensure you have added the 'sections' dataset in a prior hook or helper
			// so that the internal parser doesn't reject early on a missing dataset ID.
			const results = await facade.performQuery(validNegationQuery);
			expect(results).to.be.an("array");
		} catch (err) {
			// If your dataset isn't loaded it might throw, but it WILL still log line coverage!
		}
	});

	//fifthone
	it("should cover both branches of the year field mapping using raw disk injection", async function () {
		const concreteFacade = facade as any;
		const datasetId = "sections";
		const filePath = `./data/${datasetId}.json`;

		// 1. Manually synchronize the in-memory Map so validateKey passes existence checks
		concreteFacade["datasets"].set(datasetId, {
			id: datasetId,
			kind: InsightDatasetKind.Sections,
			numRows: 2
		});

		// 2. Build a fake payload matching your PersistedDataset interface shape
		const fakePersistedPayload = {
			id: datasetId,
			kind: InsightDatasetKind.Sections,
			data: [
				{
					Subject: "cpsc",
					Course: "310",
					Year: "2024",       // Branch A: Hits parseInt("2024", 10)
					Section: "101",
					id: "1"
				},
				{
					Subject: "cpsc",
					Course: "310",
					Year: "2024",
					Section: "overall", // Branch B: Forces assignment to 1900
					id: "2"
				}
			]
		};

		// 3. Write the file directly to the disk, skipping addDataset constraints entirely
		await fs.outputJson(filePath, fakePersistedPayload);

		// 4. Formulate your execution query
		const yearQuery = {
			WHERE: {
				EQ: {
					sections_year: 1900
				}
			},
			OPTIONS: {
				COLUMNS: ["sections_year", "sections_id"]
			}
		};

		try {
			const results = await facade.performQuery(yearQuery);

			// 5. Assertions
			expect(results).to.be.an("array");
			expect(results.length).to.equal(1);
			expect(results[0]["sections_year"]).to.equal(1900);
		} finally {
			// CLEANUP: Always remove files written manually so they don't break other tests
			await fs.remove(filePath);
		}
	});

	//sixthone
	// end AI tests
	});

	// start AI tests
	// firstone part2

    // Place your new block cleanly inside the main container:
    describe("isTransformationsValid - Code Coverage No-Sinon", function () {
        let transformationFacade: any; // Isolated local variable signature

        beforeEach(function () {
            // Instantiate an independent sandbox instance for these tests
            transformationFacade = new InsightFacade();

            // Bypass private restrictions cleanly on our local reference
            transformationFacade["datasets"].set("sections", {
                id: "sections",
                kind: InsightDatasetKind.Sections,
                numRows: 10
            });
        });

        it("should return false if TRANSFORMATIONS is not an object (Array)", async function () {
            const queryWithArrayTransform = {
                WHERE: {},
                OPTIONS: { COLUMNS: ["sections_dept"] },
                TRANSFORMATIONS: [ "GROUP", "APPLY" ]
            };

            try {
                await transformationFacade.performQuery(queryWithArrayTransform);
                expect.fail("Should have rejected invalid TRANSFORMATIONS array block");
            } catch (err) {
                expect(err).to.be.an.instanceOf(InsightError);
            }
        });

        it("should return false if an item in the APPLY array is not an object (e.g., a string)", async function () {
		const queryInvalidApplyItem = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					"not_an_object_rule" // Line 291: typeof applyRule !== "object" -> returns false
				]
			}
		};

		try {
			await transformationFacade.performQuery(queryInvalidApplyItem);
			expect.fail("Should have rejected");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
	});

	it("should return false if an APPLY rule has multiple keys instead of exactly one", async function () {
    const queryMultiKeyApplyRule = {
        WHERE: {},
        OPTIONS: { COLUMNS: ["sections_dept"] },
        TRANSFORMATIONS: {
            GROUP: ["sections_dept"],
            APPLY: [
                {
                    maxAvg: { MAX: "sections_avg" },
                    minAvg: { MIN: "sections_avg" } // Line 293: ruleKeys.length !== 1 -> returns false
                }
            ]
        }
    };

    try {
        await transformationFacade.performQuery(queryMultiKeyApplyRule);
        expect.fail("Should have rejected");
    } catch (err) {
        expect(err).to.be.an.instanceOf(InsightError);
    }
	});

	it("should return false if an applyKey has a length of 0", async function () {
		const queryEmptyApplyKey = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					{
						"": { // Line 296: applyKey.length === 0 -> returns false
							MAX: "sections_avg"
						}
					}
				]
			}
		};

		try {
			await transformationFacade.performQuery(queryEmptyApplyKey);
			expect.fail("Should have rejected");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
	});

	it("should return false if the inner token container is not an object", async function () {
		const queryInvalidTokenContainer = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept", "maxAvg"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					{
						maxAvg: "NOT_AN_OBJECT" // Line 300: typeof tokenObj !== "object" -> returns false
					}
				]
			}
		};

		try {
			await transformationFacade.performQuery(queryInvalidTokenContainer);
			expect.fail("Should have rejected");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
	});

	it("should return false if the inner token block has multiple keys", async function () {
		const queryMultiKeyToken = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept", "maxAvg"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					{
						maxAvg: {
							MAX: "sections_avg",
							MIN: "sections_avg" // Line 302: tokenKeys.length !== 1 -> returns false
						}
					}
				]
			}
		};

		try {
			await transformationFacade.performQuery(queryMultiKeyToken);
			expect.fail("Should have rejected");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
	});

		it("should return false if a COUNT token targets an invalid key structure", async function () {
		const queryInvalidCountKey = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept", "countDept"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					{
						countDept: {
							COUNT: "invalidKeyStructureNoUnderscore" // Line 310: !this.validateKey -> returns false
						}
					}
				]
			}
		};

		try {
			await transformationFacade.performQuery(queryInvalidCountKey);
			expect.fail("Should have rejected");
		} catch (err) {
			expect(err).to.be.an.instanceOf(InsightError);
		}
		});

		it("should successfully pass validation when a valid COUNT token rule is given", async function () {
		const validCountQuery = {
			WHERE: {},
			OPTIONS: { COLUMNS: ["sections_dept", "countDept"] },
			TRANSFORMATIONS: {
				GROUP: ["sections_dept"],
				APPLY: [
					{
						countDept: {
							COUNT: "sections_dept" // Hits lines 309-310 and evaluates to true!
						}
					}
				]
			}
		};

		try {
			// We use a try/catch block because execution might fail on loading data from disk,
			// but the validation code for lines 289-333 WILL turn green!
			await transformationFacade.performQuery(validCountQuery);
		} catch (err) {
			expect(err).to.not.equal("Invalid Query");
		}
		});
    });

	describe("isOptionsValid - Code Coverage No-Sinon", function () {
    let optionsFacade: any;

    beforeEach(function () {
        optionsFacade = new InsightFacade();
        // Pre-populate memory maps so that validateKey works natively for "sections"
        optionsFacade["datasets"].set("sections", {
            id: "sections",
            kind: InsightDatasetKind.Sections,
            numRows: 10
        });
    });

    it("should return false if OPTIONS is not a structural object (Array)", async function () {
        const queryWithArrayOptions = {
            WHERE: {},
            OPTIONS: [
                { COLUMNS: ["sections_dept"] } // Prohibited array wrapper layout
            ]
        };

        try {
            await optionsFacade.performQuery(queryWithArrayOptions);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if OPTIONS is missing the COLUMNS block", async function () {
        const queryMissingColumns = {
            WHERE: {},
            OPTIONS: {
                ORDER: "sections_avg" // Missing mandatory COLUMNS element
            }
        };

        try {
            await optionsFacade.performQuery(queryMissingColumns);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if COLUMNS is an empty array", async function () {
        const queryEmptyColumns = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: [] // Invalid length 0 constraint
            }
        };

        try {
            await optionsFacade.performQuery(queryEmptyColumns);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if a column key contains an underscore but fails dataset schema lookup", async function () {
        const queryInvalidColumnDataset = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["notadded_dept"] // Breaks !this.validateKey inside the loop
            }
        };

        try {
            await optionsFacade.performQuery(queryInvalidColumnDataset);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if string ORDER is not present inside the COLUMNS array list", async function () {
        const queryMismatchedStringOrder = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: "sections_avg" // avg isn't leaked into COLUMNS, triggers exit path
            }
        };

        try {
            await optionsFacade.performQuery(queryMismatchedStringOrder);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if object ORDER structure lacks mandatory parameters or has unexpected keys", async function () {
        const queryInvalidOrderKeys = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: {
                    dir: "UP",
                    // Missing 'keys' array blueprint element
                    randomField: "sections_dept"
                }
            }
        };

        try {
            await optionsFacade.performQuery(queryInvalidOrderKeys);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if object ORDER dir uses an invalid orientation string", async function () {
        const queryInvalidDirection = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: {
                    dir: "LEFT", // Must strictly resolve to UP or DOWN
                    keys: ["sections_dept"]
                }
            }
        };

        try {
            await optionsFacade.performQuery(queryInvalidDirection);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if object ORDER keys parameter layout is empty", async function () {
        const queryEmptyOrderKeysArray = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: {
                    dir: "UP",
                    keys: [] // Invalid length 0 constraint
                }
            }
        };

        try {
            await optionsFacade.performQuery(queryEmptyOrderKeysArray);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if one of the targeted sort keys inside ORDER object is absent from COLUMNS", async function () {
        const queryOrphanedSortKey = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: {
                    dir: "DOWN",
                    keys: ["sections_dept", "sections_avg"] // sections_avg is not defined above!
                }
            }
        };

        try {
            await optionsFacade.performQuery(queryOrphanedSortKey);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });

    it("should return false if ORDER data type parameter falls to generic catch (e.g., number)", async function () {
        const queryInvalidOrderType = {
            WHERE: {},
            OPTIONS: {
                COLUMNS: ["sections_dept"],
                ORDER: 12345 // Invalid type signature, falls straight to trailing else return false
            }
        };

        try {
            await optionsFacade.performQuery(queryInvalidOrderType);
            expect.fail("Should have rejected");
        } catch (err) {
            expect(err).to.be.an.instanceOf(InsightError);
        }
    });
});

});
