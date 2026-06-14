import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';

import { ImportApi } from '../../core/import-api';
import {
  ColumnProfile,
  ExplorerFilterMetadata,
  ExplorerFilterPayload,
  OverviewColumn,
  TopValue,
} from '../../core/import-workflow.models';
import { ExplorerState } from '../../core/explorer-state';
import { ProjectSelection } from '../../core/project-selection';

type ExplorerColumnCategory = 'TYPE_VARIANT' | 'TIME_PERIOD' | 'AMOUNT' | 'IDENTIFIER';
type IdentifierOperator = 'Equals' | 'Contains' | 'Starts With' | 'Ends With';
type TypeVariantSort = 'frequencyDesc' | 'frequencyAsc' | 'alphabetical';

type TimeRangeValue = {
  from: string | null;
  to: string | null;
  fromYear: number | null;
  toYear: number | null;
};

type IdentifierFilterValue = {
  operator: IdentifierOperator;
  value: string;
};

type ExplorerFilterUiState = {
  activeColumns: string[];
  text: Record<string, string[]>;
  numeric: Record<string, { min: number | null; max: number | null }>;
  time: Record<string, TimeRangeValue>;
  identifier: Record<string, IdentifierFilterValue>;
  selectedColumnName: string | null;
};

type SavedExplorerFilterConfig = ExplorerFilterUiState & {
  id: string;
  name: string;
  createdAt: string;
  categories: Record<string, ExplorerColumnCategory>;
  selectedColumnName: string | null;
};

type CategoryOption = {
  value: ExplorerColumnCategory;
  label: string;
  tag: string;
  helper: string;
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    value: 'TYPE_VARIANT',
    label: 'Type / Variant',
    tag: 'TYPE',
    helper: 'A small set of repeating business values.',
  },
  {
    value: 'TIME_PERIOD',
    label: 'Time Period',
    tag: 'TIME',
    helper: 'A date, year, timestamp, or chronological period.',
  },
  {
    value: 'AMOUNT',
    label: 'Amount',
    tag: 'AMOUNT',
    helper: 'A numeric quantity, balance, amount, revenue, or cost.',
  },
  {
    value: 'IDENTIFIER',
    label: 'Identifier',
    tag: 'IDENTIFIER',
    helper: 'A business object key, code, number, or lookup value.',
  },
];

@Component({
  selector: 'app-column-category-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Select Category</h2>
    <mat-dialog-content>
      <p class="dialog-intro">{{ columnName }}</p>
      <mat-radio-group class="category-option-list" [(ngModel)]="selectedCategory">
        @for (option of categoryOptions; track option.value) {
          <mat-radio-button [value]="option.value" [disabled]="isCategoryDisabled(option.value)">
            <span>{{ option.label }}</span>
            <small>{{ option.helper }}</small>
          </mat-radio-button>
        }
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data.category) {
        <button mat-button type="button" [mat-dialog-close]="'CLEAR'">Clear Category</button>
      }
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!selectedCategory || isCategoryDisabled(selectedCategory)"
        [mat-dialog-close]="selectedCategory"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class ColumnCategoryDialog {
  protected readonly data = inject<{
    columnName: string;
    category: ExplorerColumnCategory | null;
    sampleValues: string[];
  }>(MAT_DIALOG_DATA);
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly columnName = this.data.columnName;
  protected selectedCategory = this.data.category;

  protected isCategoryDisabled(category: ExplorerColumnCategory): boolean {
    const sampleValues = this.data.sampleValues.filter((value) => value.trim() !== '');
    if (sampleValues.length === 0) {
      return false;
    }

    const hasAlphabeticValue = sampleValues.some((value) => /[a-z]/i.test(value));
    const allNumeric = sampleValues.every((value) => this.isNumericValue(value));
    const allYearLike = sampleValues.every((value) => this.isYearLikeValue(value));
    const allDateLike = sampleValues.every((value) => this.isDateLikeValue(value));

    if (category === 'AMOUNT') {
      return hasAlphabeticValue || allDateLike || !allNumeric;
    }

    if (category === 'TIME_PERIOD') {
      return hasAlphabeticValue || (allNumeric && !allYearLike) || (!allNumeric && !allDateLike);
    }

    return false;
  }

  private isNumericValue(value: string): boolean {
    const normalized = value.trim().replace(/\s/g, '').replace(/(?<=\d)[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    return /^[-+]?\d+(\.\d+)?$/.test(normalized);
  }

  private isYearLikeValue(value: string): boolean {
    const normalized = value.trim();
    if (!/^\d{4}$/.test(normalized)) {
      return false;
    }

    const year = Number(normalized);
    return year >= 1900 && year <= 2100;
  }

  private isDateLikeValue(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}/.test(value.trim()) || /^\d{2}\.\d{2}\.\d{4}/.test(value.trim());
  }
}

@Component({
  selector: 'app-explorer-column-selection-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Select Column</h2>
    <mat-dialog-content>
      <mat-radio-group class="column-selection-list" [(ngModel)]="selectedColumnName">
        @for (column of data.columns; track column.name) {
          <mat-radio-button
            [value]="column.name"
            [class.current-selection]="column.name === data.currentColumnName"
          >
            <span class="column-selection-row">
              <strong>{{ column.name }}</strong>
              @if (getCategoryOption(data.categories[column.name]); as category) {
                <span
                  class="category-tag"
                  [class.type-variant]="category.value === 'TYPE_VARIANT'"
                  [class.time-period]="category.value === 'TIME_PERIOD'"
                  [class.amount]="category.value === 'AMOUNT'"
                  [class.identifier]="category.value === 'IDENTIFIER'"
                >
                  {{ category.tag }}
                </span>
              } @else {
                <span class="category-tag no-category">No Category</span>
              }
            </span>
            <small>{{ column.type }}</small>
          </mat-radio-button>
        }
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [disabled]="!selectedColumnName" [mat-dialog-close]="selectedColumnName">
        Confirm
      </button>
    </mat-dialog-actions>
  `,
})
export class ExplorerColumnSelectionDialog {
  protected readonly data = inject<{
    columns: OverviewColumn[];
    currentColumnName: string | null;
    categories: Record<string, ExplorerColumnCategory>;
  }>(MAT_DIALOG_DATA);
  protected selectedColumnName = this.data.currentColumnName;

  protected getCategoryOption(category: ExplorerColumnCategory | null | undefined): CategoryOption | null {
    if (!category) {
      return null;
    }

    return CATEGORY_OPTIONS.find((option) => option.value === category) ?? null;
  }
}

@Component({
  selector: 'app-save-explorer-filters-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Save Filters</h2>
    <mat-dialog-content>
      @if (data.limitReached) {
        <p class="dialog-error">Maximum number of saved filter configurations reached.</p>
      }
      <label class="template-name-field">
        <span>Filter Name</span>
        <mat-form-field appearance="outline">
          <input
            matInput
            [(ngModel)]="filterName"
            placeholder="Enter filter name"
            [disabled]="data.limitReached"
          />
        </mat-form-field>
      </label>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="data.limitReached || !filterName.trim()"
        [mat-dialog-close]="filterName.trim()"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class SaveExplorerFiltersDialog {
  protected readonly data = inject<{ limitReached: boolean }>(MAT_DIALOG_DATA);
  protected filterName = '';
}

@Component({
  selector: 'app-load-explorer-filters-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatIconModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Load Filters</h2>
    <mat-dialog-content>
      @if (data.configs.length === 0) {
        <p class="empty-template-list">No saved filter configurations available.</p>
      } @else {
        <mat-radio-group class="saved-filter-list" [(ngModel)]="selectedConfigId">
          @for (config of data.configs; track config.id) {
            <div class="saved-filter-list-row">
              <mat-radio-button [value]="config.id">
                <span>{{ config.name }}</span>
                <small>{{ formatDate(config.createdAt) }}</small>
              </mat-radio-button>
              <button
                mat-icon-button
                type="button"
                class="saved-filter-delete-button"
                aria-label="Delete saved view"
                [mat-dialog-close]="{ action: 'delete', id: config.id }"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
        </mat-radio-group>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!selectedConfigId"
        [mat-dialog-close]="{ action: 'load', id: selectedConfigId }"
      >
        Load
      </button>
    </mat-dialog-actions>
  `,
})
export class LoadExplorerFiltersDialog {
  protected readonly data = inject<{ configs: SavedExplorerFilterConfig[] }>(MAT_DIALOG_DATA);
  protected selectedConfigId: string | null = null;

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }
}

@Component({
  selector: 'app-delete-saved-view-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Delete Saved View</h2>
    <mat-dialog-content>
      <p class="dialog-intro">Delete saved view "{{ data.name }}"?</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
})
export class DeleteSavedViewDialog {
  protected readonly data = inject<{ name: string }>(MAT_DIALOG_DATA);
}

@Component({
  selector: 'app-explorer',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSliderModule,
  ],
  templateUrl: './explorer.html',
})
export class Explorer implements OnInit {
  private readonly categoryStoragePrefix = 'analytica:explorer-column-categories';
  private readonly filterStateStoragePrefix = 'analytica:explorer-filter-state';
  private readonly savedFiltersStoragePrefix = 'analytica:explorer-saved-filters';
  private readonly maxSavedFilterConfigs = 10;
  private readonly importApi = inject(ImportApi);
  private readonly dialog = inject(MatDialog);
  private readonly explorerState = inject(ExplorerState);
  protected readonly projectSelection = inject(ProjectSelection);
  protected readonly identifierOperators: IdentifierOperator[] = [
    'Equals',
    'Contains',
    'Starts With',
    'Ends With',
  ];
  protected readonly typeVariantSortOptions: { value: TypeVariantSort; label: string }[] = [
    { value: 'frequencyDesc', label: 'Frequency Descending' },
    { value: 'frequencyAsc', label: 'Frequency Ascending' },
    { value: 'alphabetical', label: 'Alphabetical' },
  ];

  protected readonly explorerDataset = this.explorerState.filteredDataset;
  protected readonly originalExplorerDataset = this.explorerState.originalDataset;
  protected readonly selectedColumnName = this.explorerState.selectedColumnName;
  protected readonly selectedColumnProfile = this.explorerState.selectedColumnProfile;
  protected readonly selectedColumn = this.explorerState.selectedColumn;
  protected readonly isDatasetLoading = signal(false);
  protected readonly isColumnLoading = signal(false);
  protected readonly isFiltering = signal(false);
  protected readonly errorMessage = signal('');
  protected textFilterValues: Record<string, string[]> = {};
  protected numericFilterValues: Record<string, { min: number | null; max: number | null }> = {};
  protected timeFilterValues: Record<string, TimeRangeValue> = {};
  protected identifierFilterValues: Record<string, IdentifierFilterValue> = {};
  protected columnCategories: Record<string, ExplorerColumnCategory> = {};
  protected activeFilterColumns: string[] = [];
  protected typeVariantSort: TypeVariantSort = 'frequencyDesc';

  protected readonly previewColumns = computed(() => this.explorerDataset()?.preview.columns ?? []);
  protected readonly previewRows = computed(() => this.explorerDataset()?.preview.rows ?? []);
  protected get filterColumns(): OverviewColumn[] {
    const columns = this.explorerDataset()?.columns ?? [];
    return this.activeFilterColumns
      .map((columnName) => columns.find((column) => column.name === columnName))
      .filter(
        (column): column is OverviewColumn =>
          column !== undefined && this.getColumnCategory(column.name) !== null,
      );
  }

  ngOnInit(): void {
    const activeProject = this.projectSelection.activeProject();
    const datasetId = activeProject?.datasetMetadata?.datasetId;
    console.info('Explorer dataset context', {
      projectId: activeProject?.id ?? null,
      datasetId: datasetId ?? null,
    });

    if (!datasetId) {
      this.errorMessage.set('Open a project created from uploaded files to explore its dataset.');
      return;
    }

    this.columnCategories = this.loadColumnCategories();
    this.loadFilterState();
    this.isDatasetLoading.set(true);
    this.errorMessage.set('');

    this.importApi.getExplorerDataset(datasetId).subscribe({
      next: (dataset) => {
        console.info('Explorer dataset loaded', {
          datasetId: dataset.datasetId,
          columnCount: dataset.columns.length,
          rowCount: dataset.summary.totalRows,
          columns: dataset.columns.map((column) => column.name),
        });
        this.explorerState.setDataset(dataset);
        this.isDatasetLoading.set(false);
        this.initialiseCategorizedFilterValues();
        if (this.activeFilterColumns.length > 0 || this.selectedColumnName()) {
          this.applyFilters();
        }
      },
      error: () => {
        this.isDatasetLoading.set(false);
        this.errorMessage.set('Explorer dataset could not be loaded.');
      },
    });
  }

  protected selectProfilerColumn(columnName: string): void {
    const datasetId = this.explorerDataset()?.datasetId;
    if (!datasetId) {
      return;
    }

    if (this.selectedColumnName() === columnName) {
      if (!this.getColumnCategory(columnName)) {
        this.openCategoryDialog(columnName, { activateFilter: false, refreshProfiler: true });
      }
      return;
    }

    this.selectedColumnName.set(columnName);
    this.selectedColumnProfile.set(null);
    this.saveFilterState();

    if (!this.getColumnCategory(columnName)) {
      this.openCategoryDialog(columnName, { activateFilter: false, refreshProfiler: true });
      return;
    }

    this.isColumnLoading.set(true);
    this.applyFilters();
  }

  protected onColumnHeaderClick(columnName: string, event: MouseEvent): void {
    if (event.detail > 1) {
      return;
    }

    if (this.getColumnCategory(columnName)) {
      this.activateFilterColumn(columnName);
      this.applyFilters();
    } else {
      this.openCategoryDialog(columnName, { activateFilter: true, refreshProfiler: false });
    }
  }

  protected onColumnHeaderDoubleClick(columnName: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.getColumnCategory(columnName)) {
      this.openCategoryDialog(columnName);
    }
  }

  protected openCategoryDialog(
    columnName: string,
    options: { activateFilter?: boolean; refreshProfiler?: boolean } = {
      activateFilter: true,
      refreshProfiler: true,
    },
  ): void {
    this.dialog
      .open(ColumnCategoryDialog, {
        width: '460px',
        data: {
          columnName,
          category: this.getColumnCategory(columnName),
          sampleValues: this.getColumnSampleValues(columnName),
        },
      })
      .afterClosed()
      .subscribe((category?: ExplorerColumnCategory | 'CLEAR') => {
        if (!category) {
          return;
        }

        const previousCategory = this.getColumnCategory(columnName);

        if (category === 'CLEAR') {
          this.clearFilterValue(columnName);
          const { [columnName]: _removed, ...remainingCategories } = this.columnCategories;
          this.columnCategories = remainingCategories;
          this.activeFilterColumns = this.activeFilterColumns.filter((item) => item !== columnName);
          const { [columnName]: _metadata, ...remainingMetadata } = this.explorerState.filterMetadata();
          this.explorerState.filterMetadata.set(remainingMetadata);
          this.saveColumnCategories();
          this.saveFilterState();
          this.applyFilters();
          return;
        }

        if (previousCategory !== category) {
          this.clearFilterValue(columnName);
        }

        this.columnCategories = {
          ...this.columnCategories,
          [columnName]: category,
        };
        if (options.activateFilter !== false) {
          this.activateFilterColumn(columnName);
        }
        this.initialiseFilterValue(columnName);
        this.saveColumnCategories();
        this.saveFilterState();

        if (
          options.activateFilter !== false ||
          options.refreshProfiler !== false ||
          this.selectedColumnName() === columnName
        ) {
          this.applyFilters();
        }
      });
  }

  protected isSelectedColumn(columnName: string): boolean {
    return this.selectedColumnName() === columnName;
  }

  protected hasFilterColumn(columnName: string): boolean {
    return this.activeFilterColumns.includes(columnName);
  }

  protected getColumnCategory(columnName: string): ExplorerColumnCategory | null {
    return this.columnCategories[columnName] ?? null;
  }

  protected getCategoryOption(category: ExplorerColumnCategory | null): CategoryOption | null {
    if (!category) {
      return null;
    }

    return CATEGORY_OPTIONS.find((option) => option.value === category) ?? null;
  }

  protected getFilterMetadata(columnName: string): ExplorerFilterMetadata | null {
    return this.explorerState.filterMetadata()[columnName] ?? null;
  }

  protected getTextValues(columnName: string): string[] {
    return this.textFilterValues[columnName] ?? [];
  }

  protected updateTextFilter(columnName: string, values: string[]): void {
    this.textFilterValues = { ...this.textFilterValues, [columnName]: values };
    this.saveFilterState();
    this.applyFilters();
  }

  protected getNumericRange(columnName: string): { min: number | null; max: number | null } {
    return this.numericFilterValues[columnName] ?? { min: null, max: null };
  }

  protected updateNumericFilter(
    columnName: string,
    key: 'min' | 'max',
    value: string | number | null,
  ): void {
    const currentRange = this.getNumericRange(columnName);
    const parsedValue = value === null || value === '' ? null : Number(value);
    const nextValue = parsedValue !== null && Number.isFinite(parsedValue) ? parsedValue : null;
    this.numericFilterValues = {
      ...this.numericFilterValues,
      [columnName]: {
        ...currentRange,
        [key]: nextValue,
      },
    };
    this.saveFilterState();
    this.applyFilters();
  }

  protected getTimeRange(columnName: string): TimeRangeValue {
    return (
      this.timeFilterValues[columnName] ?? {
        from: null,
        to: null,
        fromYear: null,
        toYear: null,
      }
    );
  }

  protected getDefaultFromYear(columnName: string): number | null {
    const range = this.getTimeRange(columnName);
    return range.fromYear ?? this.toNullableNumber(this.getFilterMetadata(columnName)?.min);
  }

  protected getDefaultToYear(columnName: string): number | null {
    const range = this.getTimeRange(columnName);
    return range.toYear ?? this.toNullableNumber(this.getFilterMetadata(columnName)?.max);
  }

  protected updateTimeFilter(
    columnName: string,
    key: keyof TimeRangeValue,
    value: string | number | null,
  ): void {
    const currentRange = this.getTimeRange(columnName);
    const nextValue =
      key === 'fromYear' || key === 'toYear'
        ? this.parseOptionalNumber(value)
        : value === '' || value === null
          ? null
          : String(value);

    this.timeFilterValues = {
      ...this.timeFilterValues,
      [columnName]: {
        ...currentRange,
        [key]: nextValue,
      },
    };
    this.saveFilterState();
    this.applyFilters();
  }

  protected getIdentifierFilter(columnName: string): IdentifierFilterValue {
    return this.identifierFilterValues[columnName] ?? { operator: 'Contains', value: '' };
  }

  protected updateIdentifierOperator(columnName: string, operator: IdentifierOperator): void {
    const currentValue = this.getIdentifierFilter(columnName);
    this.identifierFilterValues = {
      ...this.identifierFilterValues,
      [columnName]: {
        ...currentValue,
        operator,
      },
    };
    this.saveFilterState();
    this.applyFilters();
  }

  protected updateIdentifierValue(columnName: string, value: string): void {
    const currentValue = this.getIdentifierFilter(columnName);
    this.identifierFilterValues = {
      ...this.identifierFilterValues,
      [columnName]: {
        ...currentValue,
        value,
      },
    };
    this.saveFilterState();
    this.applyFilters();
  }

  protected resetFilters(): void {
    this.textFilterValues = {};
    this.numericFilterValues = {};
    this.timeFilterValues = {};
    this.identifierFilterValues = {};
    this.activeFilterColumns = [];
    this.initialiseCategorizedFilterValues();
    this.saveFilterState();
    this.applyFilters();
  }

  protected openProfilerColumnDialog(): void {
    const columns = this.explorerDataset()?.columns ?? [];
    this.dialog
      .open(ExplorerColumnSelectionDialog, {
        width: '520px',
        data: {
          columns,
          currentColumnName: this.selectedColumnName(),
          categories: this.columnCategories,
        },
      })
      .afterClosed()
      .subscribe((columnName?: string) => {
        if (!columnName) {
          return;
        }

        this.selectProfilerColumn(columnName);
      });
  }

  protected openSaveFiltersDialog(): void {
    const savedConfigs = this.loadSavedFilterConfigs();
    this.dialog
      .open(SaveExplorerFiltersDialog, {
        width: '440px',
        data: {
          limitReached: savedConfigs.length >= this.maxSavedFilterConfigs,
        },
      })
      .afterClosed()
      .subscribe((filterName?: string) => {
        if (!filterName) {
          return;
        }

        const nextConfigs = [
          ...savedConfigs,
          {
            ...this.createFilterStateSnapshot(),
            id: crypto.randomUUID(),
            name: filterName,
            createdAt: new Date().toISOString(),
            categories: this.columnCategories,
            selectedColumnName: this.selectedColumnName(),
          },
        ].slice(0, this.maxSavedFilterConfigs);
        this.saveSavedFilterConfigs(nextConfigs);
      });
  }

  protected openLoadFiltersDialog(): void {
    const savedConfigs = this.loadSavedFilterConfigs();
    this.dialog
      .open(LoadExplorerFiltersDialog, {
        width: '520px',
        data: {
          configs: savedConfigs,
        },
      })
      .afterClosed()
      .subscribe((result?: { action: 'load' | 'delete'; id: string }) => {
        if (!result) {
          return;
        }

        const config = savedConfigs.find((item) => item.id === result.id);
        if (!config) {
          return;
        }

        if (result.action === 'delete') {
          this.confirmDeleteSavedFilterConfig(config);
          return;
        }

        this.columnCategories = { ...config.categories };
        this.activeFilterColumns = [...config.activeColumns];
        this.textFilterValues = { ...config.text };
        this.numericFilterValues = { ...config.numeric };
        this.timeFilterValues = { ...config.time };
        this.identifierFilterValues = { ...config.identifier };
        this.selectedColumnName.set(config.selectedColumnName);
        this.selectedColumnProfile.set(null);
        this.saveColumnCategories();
        this.saveFilterState();
        this.applyFilters();
      });
  }

  protected confirmDeleteSavedFilterConfig(config: SavedExplorerFilterConfig): void {
    this.dialog
      .open(DeleteSavedViewDialog, {
        width: '420px',
        data: {
          name: config.name,
        },
      })
      .afterClosed()
      .subscribe((confirmed?: boolean) => {
        if (!confirmed) {
          this.openLoadFiltersDialog();
          return;
        }

        const nextConfigs = this.loadSavedFilterConfigs().filter((item) => item.id !== config.id);
        this.saveSavedFilterConfigs(nextConfigs);
        this.openLoadFiltersDialog();
      });
  }

  protected removeFilterColumn(columnName: string): void {
    this.activeFilterColumns = this.activeFilterColumns.filter((item) => item !== columnName);
    this.clearFilterValue(columnName);
    const { [columnName]: _metadata, ...remainingMetadata } = this.explorerState.filterMetadata();
    this.explorerState.filterMetadata.set(remainingMetadata);
    this.saveFilterState();
    this.applyFilters();
  }

  protected getTopValues(profile: ColumnProfile): TopValue[] {
    return profile.mostFrequentIds ?? profile.topFrequencies ?? profile.topValues;
  }

  protected getProfilerCategory(profile: ColumnProfile): ExplorerColumnCategory | null {
    return this.getColumnCategory(profile.name) ?? profile.explorerCategory ?? null;
  }

  protected updateTypeVariantSort(sort: TypeVariantSort): void {
    this.typeVariantSort = sort;
  }

  protected getTypeVariantValues(profile: ColumnProfile): TopValue[] {
    const values = [...(profile.topFrequencies ?? profile.topValues)];
    if (this.typeVariantSort === 'frequencyAsc') {
      return values.sort((left, right) => left.count - right.count);
    }

    if (this.typeVariantSort === 'alphabetical') {
      return values.sort((left, right) => String(left.value).localeCompare(String(right.value)));
    }

    return values.sort((left, right) => right.count - left.count);
  }

  protected getIdentifierValues(profile: ColumnProfile): TopValue[] {
    return profile.mostFrequentIds ?? profile.topValues;
  }

  protected getTimeDistribution(profile: ColumnProfile) {
    return profile.timelineDistribution ?? [];
  }

  protected getTopValuesHeading(profile: ColumnProfile): string {
    if (profile.category === 'Identifier') {
      return 'Most Frequent Values';
    }

    if (profile.category === 'Text') {
      return 'Top Values';
    }

    return 'Top Values';
  }

  protected formatCellValue(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    return String(value);
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

  protected formatDisplayDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    const [year, month, day] = value.split('-');
    if (!year || !month || !day) {
      return value;
    }

    return `${day}.${month}.${year}`;
  }

  protected isDateTimeFilter(columnName: string): boolean {
    return this.getFilterMetadata(columnName)?.type === 'Date';
  }

  protected isYearTimeFilter(columnName: string): boolean {
    return !this.isDateTimeFilter(columnName);
  }

  private applyFilters(): void {
    const datasetId = this.originalExplorerDataset()?.datasetId ?? this.explorerDataset()?.datasetId;
    const selectedColumns = this.filterColumns.map((column) => column.name);
    const profileColumnName = this.selectedColumnName();
    if (!datasetId) {
      return;
    }

    if (selectedColumns.length === 0 && !profileColumnName) {
      this.explorerState.filterMetadata.set({});
      return;
    }

    this.isFiltering.set(true);
    if (profileColumnName) {
      this.isColumnLoading.set(true);
    }
    this.importApi
      .filterExplorerDataset(datasetId, {
        selectedColumns,
        selectedCategories: this.buildSelectedCategories(),
        filters: this.buildFilterPayload(),
        profileColumnName,
        profileCategory: profileColumnName ? this.getColumnCategory(profileColumnName) : null,
      })
      .subscribe({
        next: (result) => {
          this.explorerState.applyFilterResult(result);
          this.isFiltering.set(false);
          this.isColumnLoading.set(false);
        },
        error: () => {
          this.isFiltering.set(false);
          this.isColumnLoading.set(false);
          this.errorMessage.set('Filters could not be applied.');
        },
      });
  }

  private initialiseFilterValue(columnName: string): void {
    const category = this.getColumnCategory(columnName);
    if (!category) {
      return;
    }

    if (category === 'TYPE_VARIANT' && !this.textFilterValues[columnName]) {
      this.textFilterValues = { ...this.textFilterValues, [columnName]: [] };
    } else if (category === 'AMOUNT' && !this.numericFilterValues[columnName]) {
      this.numericFilterValues = {
        ...this.numericFilterValues,
        [columnName]: { min: null, max: null },
      };
    } else if (category === 'TIME_PERIOD' && !this.timeFilterValues[columnName]) {
      this.timeFilterValues = {
        ...this.timeFilterValues,
        [columnName]: { from: null, to: null, fromYear: null, toYear: null },
      };
    } else if (category === 'IDENTIFIER' && !this.identifierFilterValues[columnName]) {
      this.identifierFilterValues = {
        ...this.identifierFilterValues,
        [columnName]: { operator: 'Contains', value: '' },
      };
    }
  }

  private initialiseCategorizedFilterValues(): void {
    for (const column of this.filterColumns) {
      this.initialiseFilterValue(column.name);
    }
  }

  private activateFilterColumn(columnName: string): void {
    if (!this.getColumnCategory(columnName) || this.activeFilterColumns.includes(columnName)) {
      return;
    }

    this.activeFilterColumns = [...this.activeFilterColumns, columnName];
    this.initialiseFilterValue(columnName);
    this.saveFilterState();
  }

  private getColumnSampleValues(columnName: string): string[] {
    const dataset = this.originalExplorerDataset() ?? this.explorerDataset();
    const rows = dataset?.preview.rows ?? [];
    return rows
      .map((row) => row[columnName])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => String(value))
      .slice(0, 25);
  }

  private clearFilterValue(columnName: string): void {
    const { [columnName]: _text, ...remainingText } = this.textFilterValues;
    const { [columnName]: _numeric, ...remainingNumeric } = this.numericFilterValues;
    const { [columnName]: _time, ...remainingTime } = this.timeFilterValues;
    const { [columnName]: _identifier, ...remainingIdentifier } = this.identifierFilterValues;
    this.textFilterValues = remainingText;
    this.numericFilterValues = remainingNumeric;
    this.timeFilterValues = remainingTime;
    this.identifierFilterValues = remainingIdentifier;
  }

  private parseOptionalNumber(value: string | number | null): number | null {
    if (value === null || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  private toNullableNumber(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private buildFilterPayload(): ExplorerFilterPayload[] {
    const filters: ExplorerFilterPayload[] = [];

    for (const column of this.filterColumns) {
      const category = this.getColumnCategory(column.name);
      if (category === 'TYPE_VARIANT') {
        const values = this.getTextValues(column.name);
        if (values.length) {
          filters.push({
            columnName: column.name,
            category,
            values,
          });
        }
      } else if (category === 'AMOUNT') {
        const range = this.getNumericRange(column.name);
        if (range.min !== null || range.max !== null) {
          filters.push({
            columnName: column.name,
            category,
            min: range.min,
            max: range.max,
          });
        }
      } else if (category === 'TIME_PERIOD') {
        const range = this.getTimeRange(column.name);
        if (range.from || range.to || range.fromYear !== null || range.toYear !== null) {
          filters.push({
            columnName: column.name,
            category,
            from: range.from,
            to: range.to,
            fromYear: range.fromYear,
            toYear: range.toYear,
          });
        }
      } else if (category === 'IDENTIFIER') {
        const filter = this.getIdentifierFilter(column.name);
        if (filter.value.trim()) {
          filters.push({
            columnName: column.name,
            category,
            operator: filter.operator,
            value: filter.value.trim(),
          });
        }
      }
    }

    return filters;
  }

  private buildSelectedCategories(): Record<string, ExplorerColumnCategory> {
    return Object.fromEntries(
      this.activeFilterColumns
        .map((columnName) => [columnName, this.getColumnCategory(columnName)] as const)
        .filter((entry): entry is readonly [string, ExplorerColumnCategory] => entry[1] !== null),
    );
  }

  private loadColumnCategories(): Record<string, ExplorerColumnCategory> {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return {};
    }

    try {
      return JSON.parse(localStorage.getItem(this.getCategoryStorageKey(projectId)) ?? '{}');
    } catch {
      return {};
    }
  }

  private saveColumnCategories(): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return;
    }

    localStorage.setItem(this.getCategoryStorageKey(projectId), JSON.stringify(this.columnCategories));
  }

  private getCategoryStorageKey(projectId: string): string {
    return `${this.categoryStoragePrefix}:${projectId}`;
  }

  private loadFilterState(): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return;
    }

    try {
      const storedState = JSON.parse(
        localStorage.getItem(this.getFilterStateStorageKey(projectId)) ?? '{}',
      ) as Partial<ExplorerFilterUiState>;
      this.activeFilterColumns = storedState.activeColumns ?? [];
      this.textFilterValues = storedState.text ?? {};
      this.numericFilterValues = storedState.numeric ?? {};
      this.timeFilterValues = storedState.time ?? {};
      this.identifierFilterValues = storedState.identifier ?? {};
      this.selectedColumnName.set(storedState.selectedColumnName ?? null);
    } catch {
      this.textFilterValues = {};
      this.numericFilterValues = {};
      this.timeFilterValues = {};
      this.identifierFilterValues = {};
      this.activeFilterColumns = [];
      this.selectedColumnName.set(null);
    }
  }

  private saveFilterState(): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return;
    }

    const state: ExplorerFilterUiState = {
      activeColumns: this.activeFilterColumns,
      text: this.textFilterValues,
      numeric: this.numericFilterValues,
      time: this.timeFilterValues,
      identifier: this.identifierFilterValues,
      selectedColumnName: this.selectedColumnName(),
    };

    localStorage.setItem(this.getFilterStateStorageKey(projectId), JSON.stringify(state));
  }

  private getFilterStateStorageKey(projectId: string): string {
    return `${this.filterStateStoragePrefix}:${projectId}`;
  }

  private createFilterStateSnapshot(): ExplorerFilterUiState {
    return {
      activeColumns: [...this.activeFilterColumns],
      text: { ...this.textFilterValues },
      numeric: { ...this.numericFilterValues },
      time: { ...this.timeFilterValues },
      identifier: { ...this.identifierFilterValues },
      selectedColumnName: this.selectedColumnName(),
    };
  }

  private loadSavedFilterConfigs(): SavedExplorerFilterConfig[] {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return [];
    }

    try {
      return JSON.parse(localStorage.getItem(this.getSavedFiltersStorageKey(projectId)) ?? '[]');
    } catch {
      return [];
    }
  }

  private saveSavedFilterConfigs(configs: SavedExplorerFilterConfig[]): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return;
    }

    localStorage.setItem(this.getSavedFiltersStorageKey(projectId), JSON.stringify(configs));
  }

  private getSavedFiltersStorageKey(projectId: string): string {
    return `${this.savedFiltersStoragePrefix}:${projectId}`;
  }
}
