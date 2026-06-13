import express, { Application, Request, Response } from "express";
import cors from "cors";
import { StatusCodes } from "http-status-codes";
import InsightFacade from "../controller/InsightFacade";
import { InsightDatasetKind, InsightError, NotFoundError } from "../controller/IInsightFacade";

export default class Server {
	private readonly port: number;
	private express: Application;
	private facade: InsightFacade;

	constructor(port: number) {
		this.port = port;
		this.express = express();
		this.facade = new InsightFacade();
		this.registerMiddleware();
		this.registerRoutes();
	}

	public start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.express
				.listen(this.port, () => {
					console.log(`Server running on port ${this.port}`);
					resolve();
				})
				.on("error", (err) => {
					reject(err);
				});
		});
	}

	private registerMiddleware(): void {
		this.express.use(express.json({ limit: "100mb" }));
		this.express.use(cors());
	}

	private registerRoutes(): void {
		// Add dataset
		this.express.put("/dataset/:id/:kind", this.addDataset.bind(this));
		// Remove dataset
		this.express.delete("/dataset/:id", this.removeDataset.bind(this));
		// List datasets
		this.express.get("/datasets", this.listDatasets.bind(this));
		// Perform query
		this.express.post("/query", this.performQuery.bind(this));
	}

	private async addDataset(req: Request, res: Response): Promise<void> {
		try {
			const { id, kind } = req.params;
			const datasetKind = kind === "rooms" ? InsightDatasetKind.Rooms : InsightDatasetKind.Sections;
			const { content } = req.body;
			const result = await this.facade.addDataset(id, content, datasetKind);
			res.status(StatusCodes.OK).json({ result });
		} catch (err) {
			if (err instanceof InsightError) {
				res.status(StatusCodes.BAD_REQUEST).json({ error: (err as Error).message });
			} else {
				res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Unexpected error" });
			}
		}
	}

	private async removeDataset(req: Request, res: Response): Promise<void> {
		try {
			const { id } = req.params;
			const result = await this.facade.removeDataset(id);
			res.status(StatusCodes.OK).json({ result });
		} catch (err) {
			if (err instanceof NotFoundError) {
				res.status(StatusCodes.NOT_FOUND).json({ error: (err as Error).message });
			} else if (err instanceof InsightError) {
				res.status(StatusCodes.BAD_REQUEST).json({ error: (err as Error).message });
			} else {
				res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Unexpected error" });
			}
		}
	}

	private async listDatasets(_req: Request, res: Response): Promise<void> {
		try {
			const result = await this.facade.listDatasets();
			res.status(StatusCodes.OK).json({ result });
		} catch (err) {
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Unexpected error" });
		}
	}

	private async performQuery(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.facade.performQuery(req.body);
			res.status(StatusCodes.OK).json({ result });
		} catch (err) {
			if (err instanceof InsightError) {
				res.status(StatusCodes.BAD_REQUEST).json({ error: (err as Error).message });
			} else {
				res.status(StatusCodes.TOO_MANY_REQUESTS).json({ error: (err as Error).message });
			}
		}
	}
}
