import { IInsightFacade, InsightDataset, InsightDatasetKind, InsightResult, InsightError } from "./IInsightFacade";
import JSZip from "jszip";
/**
 * This is the main programmatic entry point for the project.
 * Method documentation is in IInsightFacade
 *
 */
export default class InsightFacade implements IInsightFacade {
	private datasets: Map<string, InsightDataset>;

	constructor() {
		this.datasets = new Map<string, InsightDataset>();
	}

	public async addDataset(id: string, content: string, kind: InsightDatasetKind): Promise<string[]> {
		// TODO: Remove this once you implement the methods!
		if (id === "" || id.includes("_") || id.trim().length === 0) {
			return Promise.reject(new InsightError("Invalid id"));
		}
		if (this.datasets.has(id)) {
			return Promise.reject(new InsightError("ID already exists"));
		}
		// if (kind !== "sections") {
		// 	return Promise.reject(new InsightError("Invalid kind"));
		// }

		const zip = new JSZip();
		let loadedZip;
		try {
			loadedZip = await zip.loadAsync(content, { base64: true });
		} catch (err) {
			console.error(err);
			return Promise.reject(new InsightError("Data couldn't be unzipped!"));
		}

		const coursesFolder = loadedZip.folder("courses");
		if (coursesFolder === null) {
			return Promise.reject(new InsightError("No 'courses' folder found in dataset"));
		}

		const promises: Array<Promise<string>> = [];

		coursesFolder.forEach((relativePath, file) => {
			const fileReadPromise = file.async("string");
			promises.push(fileReadPromise);
		});
		//newZip.loadAsync(content).then((zip) => {});

		throw new Error(
			`InsightFacadeImpl::addDataset() is unimplemented! - id=${id}; content=${content?.length}; kind=${kind}`
		);
	}

	public async removeDataset(id: string): Promise<string> {
		// TODO: Remove this once you implement the methods!
		throw new Error(`InsightFacadeImpl::removeDataset() is unimplemented! - id=${id};`);
	}

	public async performQuery(query: unknown): Promise<InsightResult[]> {
		// TODO: Remove this once you implement the methods!
		throw new Error(`InsightFacadeImpl::performQuery() is unimplemented! - query=${query};`);
	}

	public async listDatasets(): Promise<InsightDataset[]> {
		// TODO: Remove this once you implement the methods!
		throw new Error(`InsightFacadeImpl::listDatasets is unimplemented!`);
	}
}
