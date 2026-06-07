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
	let pairZipData: string;
	let sections: string;

	beforeEach(async function () {
		await clearDisk();
		facade = new InsightFacade();
		pairZipData = await getContentFromArchives("pair.zip");

		await facade.addDataset("pairZipData", pairZipData, InsightDatasetKind.Sections);
	});

	describe("AddDataset", function () {
		it("should reject with a blank dataset id", async function () {
			try {
				await facade.addDataset("   ", pairZipData, InsightDatasetKind.Sections);
				expect.fail("Should have thrown!");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
			}
		});
	});

	describe("AddDataset1", function () {
		it("should reject with a _ in dataset id", async function () {
			try {
				await facade.addDataset("hello_monkey", pairZipData, InsightDatasetKind.Sections);
				expect.fail("Should have thrown!");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
			}
		});
	});

	describe("AddDataset2", function () {
		it("should reject with an actually empty dataset id", async function () {
			try {
				await facade.addDataset("", pairZipData, InsightDatasetKind.Sections);
				expect.fail("Should have thrown!");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
			}
		});
	});

	describe("AddDataset3", function () {
		it("should reject with already added dataset id", async function () {
			try {
				await facade.addDataset("bigHamsters", pairZipData, InsightDatasetKind.Sections);
				await facade.addDataset("bigHamsters", pairZipData, InsightDatasetKind.Sections);
				expect.fail("Should have thrown!");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
			}
		});
	});

	describe("AddDataset4", function () {
		it("should successfully add a valid dataset", async function () {
			try {
				const id: string = "pair";
				const expected = [id];
				await facade.removeDataset("pairZipData");
				const result = await facade.addDataset(id, pairZipData, InsightDatasetKind.Sections);
				expect(result).to.deep.equal(expected);
			} catch (_err) {
				expect.fail("Shouldn't have failed!");
			}
		});
	});

	describe("RemoveDataset1", function () {
		it("should successfully remove an existing dataset", async function () {
			// SETUP
			// your setup here
			const id: string = "ubc";
			const content: string = await getContentFromArchives("pair.zip");
			await facade.addDataset(id, content, InsightDatasetKind.Sections);
			// EXECUTION
			const result = await facade.removeDataset(id);

			// VALIDATION
			expect(result).to.equal(id);
			// your asserts here
			try {
				await facade.removeDataset(id);
				expect.fail("Should have thrown NotFoundError");
			} catch (err) {
				expect(err).to.be.instanceof(NotFoundError);
			}
		});
	});

	describe("RemoveDataset2", function () {
		it("should successfully remove an existing dataset", async function () {
			// SETUP
			// your setup here
			const id: string = "ubc";
			const content: string = await getContentFromArchives("pair.zip");
			await facade.addDataset(id, content, InsightDatasetKind.Sections);
			// EXECUTION
			await facade.removeDataset(id);
			try {
				await facade.removeDataset(id);
				expect.fail("Should have thrown NotFoundError");
			} catch (err) {
				expect(err).to.be.instanceof(NotFoundError);
			}
		});
	});

	describe("RemoveDataset3", function () {
		it("should throw InsightError for invalid '_' in id", async function () {
			// SETUP
			// your setup here
			const id: string = "ubc";
			const content: string = await getContentFromArchives("pair.zip");
			await facade.addDataset(id, content, InsightDatasetKind.Sections);
			// EXECUTION
			try {
				await facade.removeDataset("my_dataset");
				expect.fail("Should have thrown InsightError");
			} catch (err) {
				expect(err).to.be.instanceof(InsightError);
			}
		});
	});

	describe("RemoveDataset4", function () {
		it("should fail to remove a dataset that was never added", async function () {
			try {
				await facade.removeDataset("randomID");
				expect.fail("Should have thrown NotFoundError");
			} catch (err) {
				expect(err).to.be.instanceOf(NotFoundError);
			}
		});
	});

	describe("RemoteDataset", function () {
		it("should ...", async function () {
			try {
				// SETUP
				// your setup here

				// EXECUTION
				await facade.removeDataset("<dataset-id-here>");

				// VALIDATION
				// your asserts here
			} catch (_err) {}
		});
	});

	describe("ListDataset", function () {
		it("should list no datasets", async function () {
			try {
				// SETUP
				// your setup here

				// EXECUTION
				await facade.removeDataset("pairZipData");
				const datasetList = await facade.listDatasets();
				// VALIDATION
				expect(datasetList.length).to.equal(0);
				// your asserts here
			} catch (_err) {
				expect.fail("Shouldn't have failed");
			}
		});
	});

	describe("ListDataset1", function () {
		it("should list no datasets", async function () {
			try {
				// SETUP
				// your setup here
				await facade.removeDataset("pairZipData");
				const id: string = "ubc";
				const content: string = await getContentFromArchives("pair.zip");
				await facade.addDataset(id, content, InsightDatasetKind.Sections);
				// EXECUTION
				const datasetList = await facade.listDatasets();
				// VALIDATION
				expect(datasetList.length).to.equal(1);
				expect(datasetList[0].id).to.equal("ubc");
				expect(datasetList[0].kind).to.equal(InsightDatasetKind.Sections);
				expect(datasetList[0].numRows).to.be.greaterThan(0);
				// your asserts here
			} catch (_err) {
				expect.fail("Shouldn't have failed");
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
						"Do not invoke the function directly."
				);
			}
			// Destructuring assignment to reduce property accesses
			const { input, expected, errorExpected } = await loadTestQuery(this.test.title);
			let result: InsightResult[] = []; // dummy value before being reassigned
			try {
				result = await facade.performQuery(input);
			} catch (err) {
				if (!errorExpected) {
					expect.fail(`performQuery threw unexpected error: ${err}`);
				}
				// TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
				// to determine what to put here :)
				// return expect.fail("Write your assertion(s) here.");
				if (expected === "InsightError") {
					expect(err).to.be.an.instanceOf(InsightError);
				} else if (expected === "ResultTooLargeError") {
					expect(err).to.be.an.instanceOf(ResultTooLargeError);
				}
				return;
			}
			if (errorExpected) {
				expect.fail(`performQuery resolved when it should have rejected with ${expected}`);
			}
			// TODO: replace this failing assertion with your assertions. You will need to reason about the code in this function
			// to determine what to put here :)
			// return expect.fail("Write your assertion(s) here.");
			expect(result).to.be.an.instanceOf(Array);
			expect(result).to.have.deep.members(expected as InsightResult[]);
			expect(result.length).to.equal((expected as any[]).length);
		}

		before(async function () {
			facade = new InsightFacade();
			sections = await getContentFromArchives("pair.zip");

			// Add the datasets to InsightFacade once.
			// Will *fail* if there is a problem reading ANY dataset.
			const loadDatasetPromises: Promise<string[]>[] = [
				facade.addDataset("sections", sections, InsightDatasetKind.Sections),
			];

			try {
				await Promise.all(loadDatasetPromises);
			} catch (err) {
				throw new Error(`In PerformQuery Before hook, dataset(s) failed to be added. \n${err}`);
			}
		});

		after(async function () {
			await clearDisk();
		});

		// Examples demonstrating how to test performQuery using the JSON Test Queries.
		// The relative path to the query file must be given in square brackets.
		// it("[valid/simple.json] SELECT dept, avg WHERE avg > 97", checkQuery);
		it("[invalid/invalid.json] Query missing WHERE", checkQuery);
		// Start of AI generated test

		// KEEEP
		// it("should reject a query with two keys in a filter", async function () {
		// 	const query = {
		// 		WHERE: { GT: { sections_avg: 90, sections_pass: 10 } }, // TWO keys inside GT
		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
		// 	};
		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		// });

		// it("should reject a query referencing two different datasets", async function () {
		// 	// Add a second dataset first so validateKey doesn't fail on existence check
		// 	await facade.addDataset("other", sections, InsightDatasetKind.Sections);
		// 	const query = {
		// 		WHERE: {
		// 			AND: [
		// 				{ GT: { sections_avg: 90 } },
		// 				{ GT: { other_avg: 90 } }, // references 'other' instead of 'sections'
		// 			],
		// 		},
		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
		// 	};
		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		// });
		it("should reject query where ORDER is not in COLUMNS", async function () {
			const query = {
				WHERE: {},
				OPTIONS: {
					COLUMNS: ["sections_avg"],
					ORDER: "sections_dept", // dept is not in columns!
				},
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});

		// it("should reject query with invalid keys in OPTIONS", async function () {
		// 	const query = {
		// 		WHERE: {},
		// 		OPTIONS: {
		// 			COLUMNS: ["sections_avg"],
		// 			INVALID: "key", // invalid property
		// 		},
		// 	};
		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		// });
		it("should reject OR with an empty array", async function () {
			const query = {
				WHERE: { OR: [] },
				OPTIONS: { COLUMNS: ["sections_avg"] },
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});

		it("should reject AND that is an object instead of an array", async function () {
			const query = {
				WHERE: { AND: { GT: { pairZipData_avg: 90 } } }, // Should be wrapped in []
				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});
		it("should reject GT with a string value", async function () {
			const query = {
				WHERE: { GT: { pairZipData_avg: "90" } }, // Value is a string
				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});
		it("should reject IS with a number value", async function () {
			const query = {
				WHERE: { IS: { pairZipData_dept: 123 } }, // Value is a number
				OPTIONS: { COLUMNS: ["pairZipData_dept"] },
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});
		// it("should reject a query with an invalid filter nested inside AND", async function () {
		// 	const query = {
		// 		WHERE: {
		// 			AND: [
		// 				{ GT: { sections_avg: 90 } },
		// 				{ INVALID_KEY: { sections_avg: 90 } }, // Nested invalid filter
		// 			],
		// 		},
		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
		// 	};
		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		// });
		// it("should validate a query with an empty WHERE clause", async function () {
		// 	const query = {
		// 		WHERE: {},
		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
		// 	};
		// 	try {
		// 		await facade.performQuery(query);
		// 	} catch (err) {
		// 		expect(err).to.not.be.instanceOf(InsightError); // Reaches unimplemented error
		// 	}
		// });
		it("should reject a query where WHERE is a list instead of an object", async function () {
			const query = {
				WHERE: [{ GT: { pairZipData_avg: 90 } }], // WHERE is an array, not an object
				OPTIONS: { COLUMNS: ["pairZipData_avg"] },
			};
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});

		// it("should reject a query where WHERE is null", async function () {
		// 	const query = {
		// 		WHERE: null,
		// 		OPTIONS: { COLUMNS: ["sections_avg"] },
		// 	};
		// 	return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		// });
		it("should reject adding a dataset of kind 'rooms'", async function () {
			try {
				await facade.addDataset("roomsTest", pairZipData, InsightDatasetKind.Rooms);
				expect.fail("Should have rejected");
			} catch (err) {
				expect(err).to.be.an.instanceOf(InsightError);
			}
		});
		it("should validate a query with nested NOT filters", async function () {
			const query = {
				WHERE: {
					OR: [{ NOT: { GT: { pairZipData_avg: 95 } } }, { NOT: { IS: { pairZipData_dept: "cpsc" } } }],
				},
				OPTIONS: { COLUMNS: ["pairZipData_avg"], ORDER: "pairZipData_avg" },
			};
			try {
				await facade.performQuery(query);
			} catch (err) {
				// expect(err).to.be.instanceOf(InsightError);
				expect(err).to.be.instanceOf(ResultTooLargeError);
			}
		});
		it("should reject query where OPTIONS is null", async function () {
			const query = { WHERE: {}, OPTIONS: null };
			return expect(facade.performQuery(query)).to.eventually.be.rejectedWith(InsightError);
		});
		// End of AI generated test eee
	});
});
