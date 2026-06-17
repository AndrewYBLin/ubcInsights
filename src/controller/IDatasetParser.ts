import JSZip from "jszip";

export interface IDatasetParser {
	parse(zip: JSZip): Promise<any[]>;
}
