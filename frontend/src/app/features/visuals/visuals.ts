import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ImportApi } from '../../core/import-api';
import {
  ChartAggregation,
  ChartPoint,
  ChartResult,
  ChartSortOrder,
  ChartType,
  OverviewColumn,
} from '../../core/import-workflow.models';
import { ProjectSelection } from '../../core/project-selection';

type VisualBar = ChartPoint & {
  width: number;
};

type VisualPieSlice = ChartPoint & {
  color: string;
  dashArray: string;
  dashOffset: string;
};

type VisualSeriesLine = {
  name: string;
  color: string;
  points: string;
};

@Component({
  selector: 'app-visuals',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './visuals.html',
  styleUrl: './visuals.scss',
})
export class Visuals {
  private readonly importApi = inject(ImportApi);
  protected readonly projectSelection = inject(ProjectSelection);

  protected readonly chartTypes: { value: ChartType; label: string }[] = [
    { value: 'bar', label: 'Bar Chart' },
    { value: 'pie', label: 'Pie Chart' },
    { value: 'line', label: 'Line Chart' },
  ];
  protected readonly aggregations: ChartAggregation[] = ['Sum', 'Count', 'Average', 'Min', 'Max'];
  protected readonly sortOptions: { value: ChartSortOrder; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'ascending', label: 'Ascending' },
    { value: 'descending', label: 'Descending' },
  ];
  protected readonly topNOptions = [
    { value: 'all', label: 'All' },
    { value: '5', label: 'Top 5' },
    { value: '10', label: 'Top 10' },
    { value: '20', label: 'Top 20' },
    { value: 'custom', label: 'Custom' },
  ];
  protected readonly palette = ['#2f7df6', '#12b76a', '#f79009', '#7a5af8', '#ef4444', '#06aed4'];

  protected readonly columns = signal<OverviewColumn[]>([]);
  protected readonly chartResult = signal<ChartResult | null>(null);
  protected readonly isDatasetLoading = signal(false);
  protected readonly isChartLoading = signal(false);
  protected readonly errorMessage = signal('');

  protected chartType: ChartType = 'bar';
  protected categoryField = '';
  protected seriesField = '';
  protected valueField = '';
  protected aggregation: ChartAggregation = 'Sum';
  protected chartTitle = '';
  protected sortOrder: ChartSortOrder = 'none';
  protected topNMode = 'all';
  protected customTopN = 10;
  private loadedDatasetId: string | null = null;

  protected readonly numericColumns = computed(() =>
    this.columns().filter((column) => column.type === 'Integer' || column.type === 'Decimal'),
  );

  protected readonly maxChartValue = computed(() => {
    const result = this.chartResult();
    const values = result?.series?.length
      ? result.series.flatMap((series) => series.points.map((point) => point.value))
      : (result?.points.map((point) => point.value) ?? []);
    return Math.max(...values, 0);
  });

  protected readonly barPoints = computed<VisualBar[]>(() => {
    const maxValue = this.maxChartValue();
    return (this.chartResult()?.points ?? []).map((point) => ({
      ...point,
      width: maxValue > 0 ? Math.max((point.value / maxValue) * 100, 1) : 0,
    }));
  });

  protected readonly linePolyline = computed(() => {
    const points = this.chartResult()?.points ?? [];
    const maxValue = this.maxChartValue();
    if (points.length === 0 || maxValue <= 0) {
      return '';
    }

    const width = 620;
    const height = 260;
    const xStep = points.length > 1 ? width / (points.length - 1) : width;
    return points
      .map((point, index) => {
        const x = index * xStep;
        const y = height - (point.value / maxValue) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });

  protected readonly seriesLines = computed<VisualSeriesLine[]>(() => {
    const result = this.chartResult();
    const maxValue = this.maxChartValue();
    const series = result?.series ?? [];
    if (series.length === 0 || maxValue <= 0) {
      return [];
    }

    const width = 620;
    const height = 260;
    const pointCount = Math.max(result?.categories?.length ?? 0, 1);
    const xStep = pointCount > 1 ? width / (pointCount - 1) : width;

    return series.map((item, seriesIndex) => ({
      name: item.name,
      color: this.palette[seriesIndex % this.palette.length],
      points: item.points
        .map((point, index) => {
          const x = index * xStep;
          const y = height - (point.value / maxValue) * height;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' '),
    }));
  });

  protected readonly pieSlices = computed<VisualPieSlice[]>(() => {
    const points = this.chartResult()?.points ?? [];
    const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0);
    let offset = 25;

    return points.map((point, index) => {
      const percentage = total > 0 ? (Math.max(point.value, 0) / total) * 100 : 0;
      const slice = {
        ...point,
        color: this.palette[index % this.palette.length],
        dashArray: `${percentage} ${100 - percentage}`,
        dashOffset: `${offset}`,
      };
      offset -= percentage;
      return slice;
    });
  });

  constructor() {
    effect(() => {
      const datasetId = this.activeDatasetId();
      if (datasetId && datasetId !== this.loadedDatasetId) {
        this.loadDatasetFields(datasetId);
      }
    });
  }

  protected updateChartType(event: Event): void {
    this.chartType = (event.target as HTMLSelectElement).value as ChartType;
  }

  protected updateCategoryField(event: Event): void {
    this.categoryField = (event.target as HTMLSelectElement).value;
  }

  protected updateSeriesField(event: Event): void {
    this.seriesField = (event.target as HTMLSelectElement).value;
  }

  protected updateValueField(event: Event): void {
    this.valueField = (event.target as HTMLSelectElement).value;
  }

  protected updateAggregation(event: Event): void {
    this.aggregation = (event.target as HTMLSelectElement).value as ChartAggregation;
  }

  protected updateChartTitle(event: Event): void {
    this.chartTitle = (event.target as HTMLInputElement).value;
  }

  protected updateSortOrder(event: Event): void {
    this.sortOrder = (event.target as HTMLSelectElement).value as ChartSortOrder;
  }

  protected updateTopNMode(event: Event): void {
    this.topNMode = (event.target as HTMLSelectElement).value;
  }

  protected updateCustomTopN(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.customTopN = Number.isFinite(value) && value > 0 ? Math.floor(value) : this.customTopN;
  }

  protected applyChart(): void {
    const datasetId = this.activeDatasetId();
    if (!datasetId || !this.categoryField || (this.aggregation !== 'Count' && !this.valueField)) {
      return;
    }

    this.isChartLoading.set(true);
    this.errorMessage.set('');
    this.importApi
      .createChart(datasetId, {
        chartType: this.chartType,
        categoryField: this.categoryField,
        seriesField: this.chartType === 'pie' ? null : this.seriesField || null,
        valueField: this.valueField,
        aggregation: this.aggregation,
        sortOrder: this.sortOrder,
        topN: this.selectedTopN(),
        chartTitle: this.chartTitle.trim() || null,
        filters: [],
      })
      .subscribe({
        next: (result) => {
          this.chartResult.set(result);
          this.isChartLoading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(error?.error?.detail ?? 'Chart could not be generated.');
          this.isChartLoading.set(false);
        },
      });
  }

  protected canApplyChart(): boolean {
    return Boolean(this.categoryField && (this.aggregation === 'Count' || this.valueField));
  }

  protected selectedTopN(): number | null {
    if (this.topNMode === 'all') {
      return null;
    }
    if (this.topNMode === 'custom') {
      return this.customTopN;
    }
    return Number(this.topNMode);
  }

  protected topNLabel(result: ChartResult): string {
    return result.topN ? String(result.topN) : 'All';
  }

  protected hasSeries(): boolean {
    return Boolean(this.chartResult()?.series?.length);
  }

  protected formatValue(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  protected formatShortLabel(value: string): string {
    return value.length > 18 ? `${value.slice(0, 18)}...` : value;
  }

  protected activeDatasetId(): string | null {
    return this.projectSelection.activeProject()?.datasetMetadata?.datasetId ?? null;
  }

  private loadDatasetFields(datasetId: string): void {
    this.loadedDatasetId = datasetId;
    this.isDatasetLoading.set(true);
    this.errorMessage.set('');
    this.chartResult.set(null);
    this.importApi.getExplorerDataset(datasetId).subscribe({
      next: (dataset) => {
        this.columns.set(dataset.columns);
        this.categoryField = dataset.columns[0]?.name ?? '';
        this.valueField = this.numericColumns()[0]?.name ?? '';
        this.isDatasetLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Dataset fields could not be loaded.');
        this.isDatasetLoading.set(false);
      },
    });
  }
}
