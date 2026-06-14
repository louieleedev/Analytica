import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';

import { ImportApi } from '../../core/import-api';
import { ColumnProfile, DatasetOverview, OverviewColumn } from '../../core/import-workflow.models';
import { ProjectSelection } from '../../core/project-selection';

@Component({
  selector: 'app-overview',
  imports: [MatIconModule, MatProgressSpinnerModule, MatTableModule],
  templateUrl: './overview.html',
})
export class Overview implements OnInit {
  private readonly importApi = inject(ImportApi);
  protected readonly projectSelection = inject(ProjectSelection);

  protected readonly overview = signal<DatasetOverview | null>(null);
  protected readonly selectedColumn = signal<ColumnProfile | null>(null);
  protected readonly selectedColumnName = signal<string | null>(null);
  protected readonly isOverviewLoading = signal(false);
  protected readonly isColumnLoading = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly displayedColumns = ['name', 'type', 'category', 'distinct', 'nulls', 'quality'];

  protected readonly metrics = computed(() => {
    const summary = this.overview()?.summary;
    return [
      {
        label: 'Total Rows',
        value: summary ? this.formatNumber(summary.totalRows) : '-',
        icon: 'format_list_numbered',
      },
      {
        label: 'Total Columns',
        value: summary ? this.formatNumber(summary.totalColumns) : '-',
        icon: 'view_column',
      },
      {
        label: 'Imported Files',
        value: summary ? this.formatNumber(summary.importedFiles) : '-',
        icon: 'upload_file',
      },
      {
        label: 'Dataset Size',
        value: summary ? this.formatBytes(summary.datasetSize) : '-',
        icon: 'database',
      },
    ];
  });

  ngOnInit(): void {
    const activeProject = this.projectSelection.activeProject();
    const datasetId = activeProject?.datasetMetadata?.datasetId;
    console.info('Overview dataset context', {
      projectId: activeProject?.id ?? null,
      datasetId: datasetId ?? null,
    });

    if (!datasetId) {
      this.errorMessage.set('Open a project created from uploaded files to view dataset statistics.');
      return;
    }

    this.isOverviewLoading.set(true);
    this.errorMessage.set('');

    this.importApi.getDatasetOverview(datasetId).subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.isOverviewLoading.set(false);

        const firstColumn = overview.columns[0];
        if (firstColumn) {
          this.selectColumn(firstColumn);
        }
      },
      error: () => {
        this.isOverviewLoading.set(false);
        this.errorMessage.set('Dataset overview could not be loaded.');
      },
    });
  }

  protected selectColumn(column: OverviewColumn): void {
    const datasetId = this.overview()?.datasetId;
    if (!datasetId) {
      return;
    }

    this.selectedColumnName.set(column.name);
    this.isColumnLoading.set(true);
    this.importApi.getColumnProfile(datasetId, column.name).subscribe({
      next: (profile) => {
        this.selectedColumn.set(profile);
        this.isColumnLoading.set(false);
      },
      error: () => {
        this.selectedColumn.set(null);
        this.isColumnLoading.set(false);
        this.errorMessage.set(`Statistics for ${column.name} could not be loaded.`);
      },
    });
  }

  protected isSelected(column: OverviewColumn): boolean {
    return this.selectedColumnName() === column.name;
  }

  protected formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    return value.toLocaleString();
  }

  protected formatDecimal(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  protected formatPercentage(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }

  protected formatBytes(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    if (value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    if (value < 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
