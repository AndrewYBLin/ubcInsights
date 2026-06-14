import { InsightDataset, 
    InsightDatasetKind } from "./IInsightFacade";

// composite pattern component abstract/interface
export interface Filter {
    evaluate(row: any): boolean;
}

export class MCompFilter implements Filter {
    constructor(
        private field: string,
        private value: number,
        private op: (a: number, b: number) => boolean,
        private fieldToKey: Record<string, string>,
        private datasets: Map<string, InsightDataset>
    ) {}

    evaluate(row: any): boolean {
        const parts = this.field.split("_");
        const id = parts[0];
        const field = parts[1];
        const kind = this.datasets.get(id)!.kind;
        let val = row[this.fieldToKey[field]];
        if (kind === InsightDatasetKind.Sections && field === "year") {
            val = row.Section === "overall" ? 1900 : parseInt(val, 10);
        }
        return this.op(Number(val), this.value);
    }
}

export class SCompFilter implements Filter {
    constructor(
        private field: string,
        private pattern: string,
        private fieldToKey: Record<string, string>
    ) {}

    evaluate(row: any): boolean {
        const fieldName = this.field.split("_")[1];
        const val = String(row[this.fieldToKey[fieldName]]);
        let regex = this.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        regex = "^" + regex.replace(/\*/g, ".*") + "$";
        return new RegExp(regex).test(val);
    }
}

// composite filteres 
export class AndFilter implements Filter {
    constructor(private filters: Filter[]) {}
    evaluate(row: any): boolean {
        return this.filters.every((f) => f.evaluate(row));
    }
}

export class OrFilter implements Filter {
    constructor(private filters: Filter[]) {}
    evaluate(row: any): boolean {
        return this.filters.some((f) => f.evaluate(row));
    }
}

export class NotFilter implements Filter {
    constructor(private filter: Filter) {}
    evaluate(row: any): boolean {
        return !this.filter.evaluate(row);
    }
}