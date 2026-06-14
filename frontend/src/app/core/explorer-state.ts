import { Injectable, computed, signal } from '@angular/core';

import {
  ColumnProfile,
  ExplorerDataset,
  ExplorerFilterMetadata,
  ExplorerFilterResult,
} from './import-workflow.models';

@Injectable({ providedIn: 'root' })
export class ExplorerState {
  readonly originalDataset = signal<ExplorerDataset | null>(null);
  readonly filteredDataset = signal<ExplorerDataset | null>(null);
  readonly selectedColumnName = signal<string | null>(null);
  readonly selectedColumnProfile = signal<ColumnProfile | null>(null);
  readonly filterMetadata = signal<Record<string, ExplorerFilterMetadata>>({});

  readonly selectedColumn = computed(() => {
    const columnName = this.selectedColumnName();
    return this.filteredDataset()?.columns.find((column) => column.name === columnName) ?? null;
  });

  setDataset(dataset: ExplorerDataset): void {
    this.originalDataset.set(dataset);
    this.filteredDataset.set(dataset);
    this.filterMetadata.set({});
    this.selectedColumnProfile.set(null);
  }

  applyFilterResult(result: ExplorerFilterResult): void {
    const dataset = this.originalDataset() ?? this.filteredDataset();
    if (!dataset) {
      return;
    }

    this.filteredDataset.set({
      ...dataset,
      summary: result.summary,
      preview: result.preview,
    });
    this.filterMetadata.set(
      Object.fromEntries(result.filterMetadata.map((metadata) => [metadata.columnName, metadata])),
    );
    if (result.columnProfile) {
      this.selectedColumnProfile.set(result.columnProfile);
    }
  }

  reset(): void {
    this.originalDataset.set(null);
    this.filteredDataset.set(null);
    this.selectedColumnName.set(null);
    this.selectedColumnProfile.set(null);
    this.filterMetadata.set({});
  }
}
