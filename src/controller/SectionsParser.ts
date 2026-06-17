import JSZip from "jszip";
import { InsightError } from "./IInsightFacade";
import { IDatasetParser } from "./IDatasetParser";

export class SectionsParser implements IDatasetParser {
	public async parse(zip: JSZip): Promise<any[]> {
		const coursesFolder = zip.folder("courses");
		if (coursesFolder === null) {
			throw new InsightError("No 'courses' folder found");
		}

		const promises: Array<Promise<string>> = [];
		coursesFolder.forEach((relativePath, file) => {
			promises.push(file.async("string"));
		});

		const fileContents = await Promise.all(promises);
		const sections: any[] = [];

		for (const content of fileContents) {
			try {
				const parsed = JSON.parse(content);
				if (parsed.result && Array.isArray(parsed.result)) {
					sections.push(...parsed.result);
				}
			} catch (_err) {
				continue;
			}
		}
		return sections;
	}
}
