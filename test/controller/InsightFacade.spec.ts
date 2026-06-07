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
				expect.fail("Should have thrown!"); // remove once done implementation
			} catch (err) {
				expect(err).to.be.an.instanceOf(Error); // remove one done implementation
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
				expect(err)
					.to.have.property("message")
					.that.includes("Filter is not an object");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Filter must have exactly one key");
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
				expect(err)
					.to.have.property("message")
					.that.includes("non-empty array");
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
				expect(err)
					.to.have.property("message")
					.that.includes("non-empty array");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Invalid filter type");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Comparison content");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Comparison must have exactly one key");
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
				expect(err)
					.to.have.property("message")
					.that.includes("MComparison value must be a number");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Invalid Comparison key format");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Invalid Comparison key field");
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
				expect(err).to.have.property("message").that.includes("not an object");
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
				expect(err)
					.to.have.property("message")
					.that.includes("Unexpected OPTIONS key found");
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
				expect(err)
					.to.have.property("message")
					.that.includes("multiple datasets");
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


// import {
// 	InsightError,
// 	IInsightFacade,
// 	InsightDatasetKind,
// 	InsightResult,
// 	NotFoundError,
// 	ResultTooLargeError,
// } from "../../src/controller/IInsightFacade";
// import InsightFacade from "../../src/controller/InsightFacade";
// import { clearDisk, getContentFromArchives, loadTestQuery } from "../TestUtil";
//
// import { expect, use } from "chai";
// import chaiAsPromised from "chai-as-promised";
//
// use(chaiAsPromised);
//
// export interface ITestQuery {
// 	title?: string;
// 	input: unknown;
// 	errorExpected: boolean;
// 	expected: any;
// }
//
// describe("InsightFacade", function () {
// 	let facade: IInsightFacade;
//
// 	// Declare datasets used in tests. You should add more datasets like this!
// 	let pairZipData: string;
// 	let sections: string;
//
// 	beforeEach(async function () {
// 		await clearDisk();
// 		facade = new InsightFacade();
// 		pairZipData = await getContentFromArchives("pair.zip");
//
// 		await facade.addDataset("pairZipData", pairZipData, InsightDatasetKind.Sections);
// 	});
//
// 	describe("AddDataset", function () {
// 		it("should reject with a blank dataset id", async function () {
// 			try {
// 				await facade.addDataset("   ", pairZipData, InsightDatasetKind.Sections);
// 				expect.fail("Should have thrown!");
// 			} catch (err) {
// 				expect(err).to.be.an.instanceOf(InsightError);
// 			}
// 		});
// 	});
//
// 	describe("AddDataset1", function () {
// 		it("should reject with a _ in dataset id", async function () {
// 			try {
// 				await facade.addDataset("hello_monkey", pairZipData, InsightDatasetKind.Sections);
// 				expect.fail("Should have thrown!");
// 			} catch (err) {
// 				expect(err).to.be.an.instanceOf(InsightError);
// 			}
// 		});
// 	});
//
// 	describe("AddDataset2", function () {
// 		it("should reject with an actually empty dataset id", async function () {
// 			try {
// 				await facade.addDataset("", pairZipData, InsightDatasetKind.Sections);
// 				expect.fail("Should have thrown!");
// 			} catch (err) {
// 				expect(err).to.be.an.instanceOf(InsightError);
// 			}
// 		});
// 	});
//
// 	describe("AddDataset3", function () {
// 		it("should reject with already added dataset id", async function () {
// 			try {
// 				await facade.addDataset("bigHamsters", pairZipData, InsightDatasetKind.Sections);
// 				await facade.addDataset("bigHamsters", pairZipData, InsightDatasetKind.Sections);
// 				expect.fail("Should have thrown!");
// 			} catch (err) {
// 				expect(err).to.be.an.instanceOf(InsightError);
// 			}
// 		});
// 	});
//
// 	describe("AddDataset4", function () {
// 		it("should successfully add a valid dataset", async function () {
// 			try {
// 				const id: string = "pair";
// 				const expected = [id];
// 				await facade.removeDataset("pairZipData");
// 				const result = await facade.addDataset(id, pairZipData, InsightDatasetKind.Sections);
// 				expect(result).to.deep.equal(expected);
// 			} catch (_err) {
// 				expect.fail("Shouldn't have failed!");
// 			}
// 		});
// 	});
//
// 	describe("RemoveDataset1", function () {
// 		it("should successfully remove an existing dataset", async function () {
// 			// SETUP
// 			// your setup here
// 			const id: string = "ubc";
// 			const content: string = await getContentFromArchives("pair.zip");
// 			await facade.addDataset(id, content, InsightDatasetKind.Sections);
// 			// EXECUTION
// 			const result = await facade.removeDataset(id);
//
// 			// VALIDATION
// 			expect(result).to.equal(id);
// 			// your asserts here
// 			try {
// 				await facade.removeDataset(id);
// 				expect.fail("Should have thrown NotFoundError");
// 			} catch (err) {
// 				expect(err).to.be.instanceof(NotFoundError);
// 			}
// 		});
// 	});
//
// 	describe("RemoveDataset2", function () {
// 		it("should successfully remove an existing dataset", async function () {
// 			// SETUP
// 			// your setup here
// 			const id: string = "ubc";
// 			const content: string = await getContentFromArchives("pair.zip");
// 			await facade.addDataset(id, content, InsightDatasetKind.Sections);
// 			// EXECUTION
// 			await facade.removeDataset(id);
// 			try {
// 				await facade.removeDataset(id);
// 				expect.fail("Should have thrown NotFoundError");
// 			} catch (err) {
// 				expect(err).to.be.instanceof(NotFoundError);
// 			}
// 		});
// 	});
//
// 	describe("RemoveDataset3", function () {
// 		it("should throw InsightError for invalid '_' in id", async function () {
// 			// SETUP
// 			// your setup here
// 			const id: string = "ubc";
// 			const content: string = await getContentFromArchives("pair.zip");
// 			await facade.addDataset(id, content, InsightDatasetKind.Sections);
// 			// EXECUTION
// 			try {
// 				await facade.removeDataset("my_dataset");
// 				expect.fail("Should have thrown InsightError");
// 			} catch (err) {
// 				expect(err).to.be.instanceof(InsightError);
// 			}
// 		});
// 	});
//
// 	describe("RemoveDataset4", function () {
// 		it("should fail to remove a dataset that was never added", async function () {
// 			try {
// 				await facade.removeDataset("randomID");
// 				expect.fail("Should have thrown NotFoundError");
// 			} catch (err) {
// 				expect(err).to.be.instanceOf(NotFoundError);
// 			}
// 		});
// 	});
//
// 	describe("RemoteDataset", function () {
// 		it("should ...", async function () {
// 			try {
// 				// SETUP
// 				// your setup here
//
// 				// EXECUTION
// 				await facade.removeDataset("<dataset-id-here>");
//
// 				// VALIDATION
// 				// your asserts here
// 			} catch (_err) {}
// 		});
// 	});
//
// 	describe("ListDataset", function () {
// 		it("should list no datasets", async function () {
// 			try {
// 				// SETUP
// 				// your setup here
//
// 				// EXECUTION
// 				await facade.removeDataset("pairZipData");
// 				const datasetList = await facade.listDatasets();
// 				// VALIDATION
// 				expect(datasetList.length).to.equal(0);
// 				// your asserts here
// 			} catch (_err) {
// 				expect.fail("Shouldn't have failed");
// 			}
// 		});
// 	});
//
// 	describe("ListDataset1", function () {
// 		it("should list no datasets", async function () {
// 			try {
// 				// SETUP
// 				// your setup here
// 				await facade.removeDataset("pairZipData");
// 				const id: string = "ubc";
// 				const content: string = await getContentFromArchives("pair.zip");
// 				await facade.addDataset(id, content, InsightDatasetKind.Sections);
// 				// EXECUTION
// 				const datasetList = await facade.listDatasets();
// 				// VALIDATION
// 				expect(datasetList.length).to.equal(1);
// 				expect(datasetList[0].id).to.equal("ubc");
// 				expect(datasetList[0].kind).to.equal(InsightDatasetKind.Sections);
// 				expect(datasetList[0].numRows).to.be.greaterThan(0);
// 				// your asserts here
// 			} catch (_err) {
// 				expect.fail("Shouldn't have failed");
// 			}
// 		});
// 	});
//
// 	describe("PerformQuery", function () {
// 		/**
// 		 * Loads the TestQuery specified in the test name and asserts the behaviour of performQuery.
// 		 *
// 		 * Note: the 'this' parameter is automatically set by Mocha and contains information about the test.
// 		 */
// 		async function checkQuery(this: Mocha.Context): Promise<void> {
// 			if (!this.test) {
// 				throw new Error(
// 					"Invalid call to checkQuery." +
// 						"Usage: 'checkQuery' must be passed as the second parameter of Mocha's it(..) function." +
// 						"Do not invoke the function directly."
// 				);
// 			}
// 			// Destructuring assignment to reduce property accesses
// 			const { input, expected, errorExpected } = await loadTestQuery(this.test.title);
// 			let result: InsightResult[] = []; // dummy value before being reassigned
// 			try {
// 				result = await facade.performQuery(input);
// 			} catch (err) {
// 				if (!errorExpected) {
// 					expect.fail(`performQuery threw unexpected error: ${err}`);
// 				}
// 				// TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
// 				// to determine what to put here :)
// 				// return expect.fail("Write your assertion(s) here.");
// 				if (expected === "InsightError") {
// 					expect(err).to.be.an.instanceOf(InsightError);
// 				} else if (expected === "ResultTooLargeError") {
// 					expect(err).to.be.an.instanceOf(ResultTooLargeError);
// 				}
// 				return;
// 			}
// 			if (errorExpected) {
// 				expect.fail(`performQuery resolved when it should have rejected with ${expected}`);
// 			}
// 			// TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
// 			// to determine what to put here :)
// 			// return expect.fail("Write your assertion(s) here.");
// 			expect(result).to.be.an.instanceOf(Array);
// 			expect(result).to.have.deep.members(expected as InsightResult[]);
// 			expect(result.length).to.equal((expected as any[]).length);
// 		}
//
// 		before(async function () {
// 			facade = new InsightFacade();
// 			sections = await getContentFromArchives("pair.zip");
//
// 			// Add the datasets to InsightFacade once.
// 			// Will *fail* if there is a problem reading ANY dataset.
// 			const loadDatasetPromises: Promise<string[]>[] = [
// 				facade.addDataset("sections", sections, InsightDatasetKind.Sections),
// 			];
//
// 			try {
// 				await Promise.all(loadDatasetPromises);
// 			} catch (err) {
// 				throw new Error(`In PerformQuery Before hook, dataset(s) failed to be added. \n${err}`);
// 			}
// 		});
//
// 		after(async function () {
// 			await clearDisk();
// 		});
//
// 		// Examples demonstrating how to test performQuery using the JSON Test Queries.
// 		// The relative path to the query file must be given in square brackets.
// 		// it("[valid/simple.json] SELECT dept, avg WHERE avg > 97", checkQuery);
// 		it("[invalid/invalid.json] Query missing WHERE", checkQuery);
// 		// Start of AI generated test
//
// 		// KEEEP
// 		// it("should reject a query with two keys in a filter", async function () {
// 		// 	const query = {
// 		// 		WHERE: { GT: { sections_avg: 90, sections_pass: 10 } }, // TWO keys inside GT
// 		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
// 		// 	};
// 		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		// });
//
// 		// it("should reject a query referencing two different datasets", async function () {
// 		// 	// Add a second dataset first so validateKey doesn't fail on existence check
// 		// 	await facade.addDataset("other", sections, InsightDatasetKind.Sections);
// 		// 	const query = {
// 		// 		WHERE: {
// 		// 			AND: [
// 		// 				{ GT: { sections_avg: 90 } },
// 		// 				{ GT: { other_avg: 90 } }, // references 'other' instead of 'sections'
// 		// 			],
// 		// 		},
// 		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
// 		// 	};
// 		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		// });
// 		it("should reject query where ORDER is not in COLUMNS", async function () {
// 			const query = {
// 				WHERE: {},
// 				OPTIONS: {
// 					COLUMNS: ["sections_avg"],
// 					ORDER: "sections_dept", // dept is not in columns!
// 				},
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
//
// 		// it("should reject query with invalid keys in OPTIONS", async function () {
// 		// 	const query = {
// 		// 		WHERE: {},
// 		// 		OPTIONS: {
// 		// 			COLUMNS: ["sections_avg"],
// 		// 			INVALID: "key", // invalid property
// 		// 		},
// 		// 	};
// 		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		// });
// 		it("should reject OR with an empty array", async function () {
// 			const query = {
// 				WHERE: { OR: [] },
// 				OPTIONS: { COLUMNS: ["sections_avg"] },
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
//
// 		it("should reject AND that is an object instead of an array", async function () {
// 			const query = {
// 				WHERE: { AND: { GT: { pairZipData_avg: 90 } } }, // Should be wrapped in []
// 				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
// 		it("should reject GT with a string value", async function () {
// 			const query = {
// 				WHERE: { GT: { pairZipData_avg: "90" } }, // Value is a string
// 				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
// 		it("should reject IS with a number value", async function () {
// 			const query = {
// 				WHERE: { IS: { pairZipData_dept: 123 } }, // Value is a number
// 				OPTIONS: { COLUMNS: ["pairZipData_dept"] },
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
// 		// it("should reject a query with an invalid filter nested inside AND", async function () {
// 		// 	const query = {
// 		// 		WHERE: {
// 		// 			AND: [
// 		// 				{ GT: { sections_avg: 90 } },
// 		// 				{ INVALID_KEY: { sections_avg: 90 } }, // Nested invalid filter
// 		// 			],
// 		// 		},
// 		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
// 		// 	};
// 		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		// });
// 		// it("should validate a query with an empty WHERE clause", async function () {
// 		// 	const query = {
// 		// 		WHERE: {},
// 		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
// 		// 	};
// 		// 	try {
// 		// 		await facade.performQuery(query);
// 		// 	} catch (err) {
// 		// 		expect(err).to.not.be.instanceOf(InsightError); // Reaches unimplemented error
// 		// 	}
// 		// });
// 		it("should reject a query where WHERE is a list instead of an object", async function () {
// 			const query = {
// 				WHERE: [{ GT: { pairZipData_avg: 90 } }], // WHERE is an array, not an object
// 				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
// 			};
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
//
// 		// it("should reject a query where WHERE is null", async function () {
// 		// 	const query = {
// 		// 		WHERE: null,
// 		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
// 		// 	};
// 		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		// });
// 		it("should reject adding a dataset of kind 'rooms'", async function () {
// 			try {
// 				await facade.addDataset("roomsTest", pairZipData, InsightDatasetKind.Rooms);
// 				expect.fail("Should have rejected");
// 			} catch (err) {
// 				expect(err).to.be.an.instanceOf(InsightError);
// 			}
// 		});
// 		it("should validate a query with nested NOT filters", async function () {
// 			const query = {
// 				WHERE: {
// 					OR: [{ NOT: { GT: { pairZipData_avg: 95 } } }, { NOT: { IS: { pairZipData_dept: "cpsc" } } }],
// 				},
// 				OPTIONS: { COLUMNS: ["pairZipData_avg"], ORDER: "pairZipData_avg" },
// 			};
// 			try {
// 				await facade.performQuery(query);
// 			} catch (err) {
// 				// expect(err).to.be.instanceOf(InsightError);
// 				expect(err).to.be.instanceOf(ResultTooLargeError);
// 			}
// 		});
// 		it("should reject query where OPTIONS is null", async function () {
// 			const query = { WHERE: {}, OPTIONS: null };
// 			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
// 		});
// 		// End of AI generated test eee
// 	});
// });
