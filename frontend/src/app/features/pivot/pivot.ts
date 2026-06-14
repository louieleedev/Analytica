import { Component, Injectable, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ImportApi } from '../../core/import-api';
import {
  DetectedColumnType,
  ExplorerColumnCategory,
  ExplorerFilterMetadata,
  ExplorerFilterPayload,
  PivotEstimate,
  PivotRequest,
  PivotResult,
  TopValue,
} from '../../core/import-workflow.models';
import { ProjectSelection } from '../../core/project-selection';
import { ColumnCategoryDialog } from '../explorer/explorer';

type PivotFieldType = 'text' | 'number' | 'date' | 'boolean';
type PivotZoneKey = 'filters' | 'rows' | 'columns' | 'values';

type PivotField = {
  name: string;
  type: PivotFieldType;
  dataType: DetectedColumnType;
  category: ExplorerColumnCategory | null;
  distinctCount?: number;
  aggregation?: string;
  filter?: ExplorerFilterPayload;
};

type PivotZone = {
  key: PivotZoneKey;
  label: string;
  icon: string;
  helper: string;
  fields: PivotField[];
};

type PivotFieldGroup = {
  key: ExplorerColumnCategory | 'UNCATEGORIZED';
  label: string;
  fields: PivotField[];
};

type PivotTemplate = {
  id: string;
  name: string;
  config: Record<PivotZoneKey, PivotField[]>;
};

type PivotHeaderCell = {
  label: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  isTotal: boolean;
};

type PivotRenderMetrics = {
  rows: number;
  columns: number;
  cells: number;
  columnCombinations: number;
  mode: PivotRenderingMode;
};

type PivotRenderingMode = 'Hierarchical' | 'Compact' | 'Too Large';

type IdentifierOperator = 'Equals' | 'Contains' | 'Starts With';

type PersistedPivotState = {
  config: Record<PivotZoneKey, PivotField[]>;
  pivotResult: PivotResult | null;
  pivotWarnings: string[];
  hasPendingChanges: boolean;
};

@Injectable({ providedIn: 'root' })
class PivotTemplateStore {
  private readonly storageKey = 'analytica:pivot-templates';

  getTemplates(): PivotTemplate[] {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) ?? '[]') as PivotTemplate[];
    } catch {
      return [];
    }
  }

  saveTemplate(template: PivotTemplate): void {
    const templates = [...this.getTemplates(), template].slice(0, 4);
    localStorage.setItem(this.storageKey, JSON.stringify(templates));
  }

  deleteTemplate(templateId: string): void {
    const templates = this.getTemplates().filter((template) => template.id !== templateId);
    localStorage.setItem(this.storageKey, JSON.stringify(templates));
  }
}

@Component({
  selector: 'app-pivot-processing-dialog',
  imports: [MatDialogModule, MatProgressSpinnerModule],
  template: `
    <div class="pivot-processing-dialog">
      <h2 mat-dialog-title>Calculating Pivot</h2>
      <mat-dialog-content>
        <mat-spinner diameter="52"></mat-spinner>
        <div>
          <p>Preparing aggregated dataset...</p>
          <p>Calculating results...</p>
          <p>Rendering pivot table...</p>
        </div>
      </mat-dialog-content>
    </div>
  `,
})
export class PivotProcessingDialog {}

@Component({
  selector: 'app-save-pivot-template-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Save Pivot Template</h2>
    <mat-dialog-content>
      <label class="fixed-field template-name-field">
        <span>Template Name</span>
        <mat-form-field appearance="outline">
          <input #templateName matInput placeholder="Revenue Analysis" />
        </mat-form-field>
      </label>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!templateName.value.trim()" [mat-dialog-close]="templateName.value.trim()">
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class SavePivotTemplateDialog {}

@Component({
  selector: 'app-delete-pivot-template-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Delete Template</h2>
    <mat-dialog-content>
      <p>Are you sure you want to delete this template?</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
})
export class DeletePivotTemplateDialog {}

@Component({
  selector: 'app-pivot-type-filter-dialog',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Configure Filter</h2>
    <mat-dialog-content>
      <p class="dialog-intro">{{ data.fieldName }}</p>
      <mat-form-field appearance="outline" class="pivot-filter-search">
        <mat-label>Search values</mat-label>
        <input matInput [(ngModel)]="searchTerm" placeholder="Search distinct values" />
      </mat-form-field>
      <div class="pivot-filter-value-list">
        @for (item of filteredValues(); track item.value) {
          <mat-checkbox [checked]="isSelected(item.value)" (change)="toggleValue(item.value, $event.checked)">
            <span>{{ item.value }}</span>
            <small>{{ item.count.toLocaleString() }}</small>
          </mat-checkbox>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="selectedValues">Save</button>
    </mat-dialog-actions>
  `,
})
export class PivotTypeFilterDialog {
  protected readonly data = inject<{
    fieldName: string;
    values: TopValue[];
    selectedValues: string[];
  }>(MAT_DIALOG_DATA);
  protected searchTerm = '';
  protected selectedValues = [...this.data.selectedValues];

  protected filteredValues(): TopValue[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.data.values;
    }

    return this.data.values.filter((item) => item.value.toLowerCase().includes(term));
  }

  protected isSelected(value: string): boolean {
    return this.selectedValues.includes(value);
  }

  protected toggleValue(value: string, checked: boolean): void {
    this.selectedValues = checked
      ? [...new Set([...this.selectedValues, value])]
      : this.selectedValues.filter((item) => item !== value);
  }
}

@Component({
  selector: 'app-pivot-amount-filter-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Configure Filter</h2>
    <mat-dialog-content>
      <p class="dialog-intro">{{ data.fieldName }}</p>
      <div class="range-inputs">
        <mat-form-field appearance="outline">
          <mat-label>Min Value</mat-label>
          <input matInput type="number" [(ngModel)]="min" [placeholder]="formatNumber(data.minimum)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Max Value</mat-label>
          <input matInput type="number" [(ngModel)]="max" [placeholder]="formatNumber(data.maximum)" />
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="{ min: toNumber(min), max: toNumber(max) }">Save</button>
    </mat-dialog-actions>
  `,
})
export class PivotAmountFilterDialog {
  protected readonly data = inject<{
    fieldName: string;
    minimum: number | null;
    maximum: number | null;
    currentMin: number | null;
    currentMax: number | null;
  }>(MAT_DIALOG_DATA);
  protected min: number | string | null = this.data.currentMin ?? this.data.minimum;
  protected max: number | string | null = this.data.currentMax ?? this.data.maximum;

  protected formatNumber(value: number | null): string {
    return value === null ? '' : String(value);
  }

  protected toNumber(value: number | string | null): number | null {
    if (value === null || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }
}

@Component({
  selector: 'app-pivot-time-filter-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Configure Filter</h2>
    <mat-dialog-content>
      <p class="dialog-intro">{{ data.fieldName }}</p>
      @if (data.isDate) {
        <div class="range-inputs">
          <mat-form-field appearance="outline">
            <mat-label>From Date</mat-label>
            <input matInput type="date" [(ngModel)]="from" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To Date</mat-label>
            <input matInput type="date" [(ngModel)]="to" />
          </mat-form-field>
        </div>
      } @else {
        <div class="range-inputs">
          <mat-form-field appearance="outline">
            <mat-label>From Year</mat-label>
            <input matInput type="number" [(ngModel)]="fromYear" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To Year</mat-label>
            <input matInput type="number" [(ngModel)]="toYear" />
          </mat-form-field>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [mat-dialog-close]="{
          from: from || null,
          to: to || null,
          fromYear: toNumber(fromYear),
          toYear: toNumber(toYear)
        }"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class PivotTimeFilterDialog {
  protected readonly data = inject<{
    fieldName: string;
    isDate: boolean;
    from: string | null;
    to: string | null;
    minimum: number | null;
    maximum: number | null;
    currentFrom: string | null;
    currentTo: string | null;
    currentFromYear: number | null;
    currentToYear: number | null;
  }>(MAT_DIALOG_DATA);
  protected from = this.data.currentFrom ?? this.data.from ?? '';
  protected to = this.data.currentTo ?? this.data.to ?? '';
  protected fromYear: number | string | null = this.data.currentFromYear ?? this.data.minimum;
  protected toYear: number | string | null = this.data.currentToYear ?? this.data.maximum;

  protected toNumber(value: number | string | null): number | null {
    if (value === null || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }
}

@Component({
  selector: 'app-pivot-identifier-filter-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Configure Filter</h2>
    <mat-dialog-content>
      <p class="dialog-intro">{{ data.fieldName }}</p>
      <div class="identifier-filter-grid">
        <mat-form-field appearance="outline">
          <mat-label>Operator</mat-label>
          <mat-select [(ngModel)]="operator">
            @for (option of operators; track option) {
              <mat-option [value]="option">{{ option }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Search</mat-label>
          <input matInput [(ngModel)]="value" placeholder="Search identifier" />
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="{ operator, value: value.trim() }">Save</button>
    </mat-dialog-actions>
  `,
})
export class PivotIdentifierFilterDialog {
  protected readonly data = inject<{
    fieldName: string;
    operator: IdentifierOperator;
    value: string;
  }>(MAT_DIALOG_DATA);
  protected readonly operators: IdentifierOperator[] = ['Equals', 'Contains', 'Starts With'];
  protected operator: IdentifierOperator = this.data.operator;
  protected value = this.data.value;
}

@Component({
  selector: 'app-pivot-templates-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Pivot Templates</h2>
    <mat-dialog-content>
      @if (templates.length === 0) {
        <p class="empty-template-list">No templates saved yet.</p>
      } @else {
        <div class="template-list">
          @for (template of templates; track template.id) {
            <div class="template-list-row">
              <span>{{ template.name }}</span>
              <div>
                <button mat-button type="button" [mat-dialog-close]="{ action: 'load', template }">Load</button>
                <button mat-button type="button" (click)="confirmDelete(template)">
                  <mat-icon>delete</mat-icon>
                  Delete
                </button>
              </div>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
})
export class PivotTemplatesDialog {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly templateStore = inject(PivotTemplateStore);
  protected templates = [...(inject(MAT_DIALOG_DATA) as PivotTemplate[])];

  protected confirmDelete(template: PivotTemplate): void {
    this.dialog
      .open(DeletePivotTemplateDialog, { width: '380px' })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.templateStore.deleteTemplate(template.id);
        this.templates = this.templateStore.getTemplates();
        this.snackBar.open('Template deleted successfully.', 'Close', { duration: 2400 });
      });
  }
}

@Component({
  selector: 'app-pivot',
  imports: [
    DragDropModule,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './pivot.html',
})
export class Pivot {
  private readonly importApi = inject(ImportApi);
  private readonly projectSelection = inject(ProjectSelection);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly templateStore = inject(PivotTemplateStore);
  private readonly categoryStoragePrefix = 'analytica:explorer-column-categories';
  private readonly pivotStateStoragePrefix = 'analytica:pivot-state';
  private loadedDatasetId: string | null = null;

  protected readonly maxTemplates = 4;
  protected templates: PivotTemplate[] = this.templateStore.getTemplates();
  protected isProcessing = false;
  protected isLoadingFields = false;
  protected fieldErrorMessage = '';
  protected hasPendingChanges = false;
  protected valuesHelperMessage = '';
  protected pivotWarnings: string[] = [];
  protected filterHelperMessage = '';
  protected configuringFilterName = signal<string | null>(null);
  protected readonly amountAggregations = ['Sum', 'Average', 'Median', 'Min', 'Max', 'Count', 'Distinct Count'];
  protected readonly discreteAggregations = ['Count', 'Distinct Count'];

  private allFields: PivotField[] = [];
  protected availableFields: PivotField[] = [];

  protected readonly zones: PivotZone[] = [
    {
      key: 'filters',
      label: 'Filters',
      icon: 'filter_alt',
      helper: 'Limit the analysis scope',
      fields: [],
    },
    {
      key: 'rows',
      label: 'Rows',
      icon: 'view_stream',
      helper: 'Group result rows',
      fields: [],
    },
    {
      key: 'columns',
      label: 'Columns',
      icon: 'view_column',
      helper: 'Split values across columns',
      fields: [],
    },
    {
      key: 'values',
      label: 'Values',
      icon: 'functions',
      helper: 'Measures and counts',
      fields: [],
    },
  ];

  private readonly compactColumnCombinationThreshold = 500;
  private readonly hardColumnCombinationThreshold = 5_000;
  private readonly pivotColumnWarningThreshold = 200;
  private readonly pivotColumnHardThreshold = 2_000;
  private readonly renderCellThreshold = 200_000;
  private _pivotResult: PivotResult | null = null;
  protected cachedPivotHeaderCells: PivotHeaderCell[] = [];
  protected cachedPivotHeaderDepth = 1;
  protected displayedPivotRows: (string | number | boolean | null)[][] = [];
  protected pivotRenderMetrics: PivotRenderMetrics = {
    rows: 0,
    columns: 0,
    cells: 0,
    columnCombinations: 0,
    mode: 'Hierarchical',
  };
  protected pivotGridTemplateColumns = 'repeat(1, minmax(140px, 1fr))';

  protected get pivotResult(): PivotResult | null {
    return this._pivotResult;
  }

  protected set pivotResult(result: PivotResult | null) {
    this._pivotResult = result;
    this.preparePivotRendering(result);
  }

  constructor() {
    effect(() => {
      const datasetId = this.projectSelection.activeProject()?.datasetMetadata?.datasetId ?? null;
      if (datasetId === this.loadedDatasetId) {
        return;
      }

      this.loadedDatasetId = datasetId;
      this.loadDatasetFields();
    });
  }

  protected get connectedDropLists(): string[] {
    return ['availableFields', ...this.zones.map((zone) => zone.key)];
  }

  protected get canApplyPivot(): boolean {
    return (
      this.getZone('values').fields.length > 0 &&
      this.getZone('rows').fields.length > 0
    );
  }

  protected get pivotValidationMessage(): string {
    if (this.getZone('values').fields.length === 0) {
      return 'Add at least one Value field.';
    }

    if (this.getZone('rows').fields.length === 0) {
      return 'Add at least one Row field.';
    }

    return '';
  }

  protected get groupedAvailableFields(): { label: string; fields: PivotField[] }[] {
    const groups: PivotFieldGroup[] = [
      { key: 'TYPE_VARIANT', label: 'TYPE / VARIANT', fields: [] },
      { key: 'TIME_PERIOD', label: 'TIME PERIOD', fields: [] },
      { key: 'AMOUNT', label: 'AMOUNT', fields: [] },
      { key: 'IDENTIFIER', label: 'IDENTIFIER', fields: [] },
      { key: 'UNCATEGORIZED', label: 'UNCATEGORIZED', fields: [] },
    ];

    for (const field of this.availableFields) {
      const group = groups.find((item) => item.key === (field.category ?? 'UNCATEGORIZED'));
      group?.fields.push(field);
    }

    return groups.filter((group) => group.fields.length > 0);
  }

  protected getZone(key: PivotZoneKey): PivotZone {
    return this.zones.find((zone) => zone.key === key)!;
  }

  protected getCategoryTag(field: PivotField): string {
    if (field.category === 'TYPE_VARIANT') {
      return 'TYPE';
    }

    if (field.category === 'TIME_PERIOD') {
      return 'TIME';
    }

    if (field.category === 'AMOUNT') {
      return 'AMOUNT';
    }

    if (field.category === 'IDENTIFIER') {
      return 'IDENTIFIER';
    }

    return 'No Category';
  }

  protected getCategoryClass(field: PivotField): string {
    if (field.category === 'TYPE_VARIANT') {
      return 'type-variant';
    }

    if (field.category === 'TIME_PERIOD') {
      return 'time-period';
    }

    if (field.category === 'AMOUNT') {
      return 'amount';
    }

    if (field.category === 'IDENTIFIER') {
      return 'identifier';
    }

    return 'no-category';
  }

  protected getFieldTooltip(field: PivotField): string {
    return [
      field.name,
      `Type: ${this.getCategoryTag(field)}`,
      `Distinct Values: ${this.formatMetricValue(field.distinctCount ?? 0)}`,
    ].join('\n');
  }

  protected getAggregations(field: PivotField): string[] {
    return field.category === 'AMOUNT' ? this.amountAggregations : this.discreteAggregations;
  }

  protected getFieldUsageCount(fieldName: string): number {
    return this.zones.reduce(
      (count, zone) => count + zone.fields.filter((field) => field.name === fieldName).length,
      0,
    );
  }

  protected drop(event: CdkDragDrop<PivotField[]>, zoneKey: PivotZoneKey | 'availableFields'): void {
    if (this.isProcessing) {
      return;
    }

    this.valuesHelperMessage = '';
    const field = event.item.data as PivotField;

    if (event.previousContainer === event.container) {
      if (zoneKey !== 'availableFields') {
        moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
        this.markPending();
      } else {
        this.sortAvailableFields();
      }
      return;
    }

    if (zoneKey !== 'availableFields' && !field.category) {
      this.openCategoryDialog(field, (category) => {
        this.updateFieldCategory(field.name, category);
        this.warnIfLikelyHighCardinalityColumn(field.name, category, zoneKey);
        this.moveFieldByName(
          field.name,
          zoneKey,
          event.previousContainer.id as PivotZoneKey | 'availableFields',
          event.previousIndex,
          event.currentIndex,
        );
      });
      return;
    }

    this.warnIfLikelyHighCardinalityColumn(field.name, field.category, zoneKey);
    this.moveFieldByName(
      field.name,
      zoneKey,
      event.previousContainer.id as PivotZoneKey | 'availableFields',
      event.previousIndex,
      event.currentIndex,
    );
  }

  protected removeField(zone: PivotZone, field: PivotField, fieldIndex?: number): void {
    if (this.isProcessing) {
      return;
    }

    zone.fields =
      fieldIndex === undefined
        ? zone.fields.filter((zoneField) => zoneField.name !== field.name)
        : zone.fields.filter((_, index) => index !== fieldIndex);
    this.markPending();
  }

  protected updateAggregation(field: PivotField, aggregation: string): void {
    field.aggregation = this.normaliseAggregation(field, aggregation);
    this.markPending();
  }

  protected configureFilter(field: PivotField, options: { removeOnCancel?: boolean } = {}): void {
    if (this.isProcessing || this.configuringFilterName()) {
      return;
    }

    const activeProject = this.projectSelection.activeProject();
    const datasetId = activeProject?.datasetMetadata?.datasetId;
    if (!datasetId || !field.category) {
      return;
    }

    this.filterHelperMessage = '';
    this.configuringFilterName.set(field.name);
    this.importApi
      .filterExplorerDataset(datasetId, {
        selectedColumns: [field.name],
        selectedCategories: { [field.name]: field.category },
        filters: [],
      })
      .subscribe({
        next: (result) => {
          this.configuringFilterName.set(null);
          const metadata = result.filterMetadata[0];
          if (!metadata) {
            this.filterHelperMessage = 'Filter values could not be loaded.';
            return;
          }

          this.openFilterDialog(field, metadata, options);
        },
        error: () => {
          this.configuringFilterName.set(null);
          this.filterHelperMessage = 'Filter values could not be loaded.';
        },
      });
  }

  protected getFilterSummary(field: PivotField): string {
    const filter = field.filter;
    if (!filter || !field.category) {
      return 'Not configured';
    }

    if (field.category === 'TYPE_VARIANT' && 'values' in filter) {
      if (filter.values.length === 0) {
        return 'No values selected';
      }

      return filter.values.length <= 3
        ? `Selected: ${filter.values.join(', ')}`
        : `Selected: ${filter.values.length} values`;
    }

    if (field.category === 'AMOUNT' && 'min' in filter && 'max' in filter) {
      return `Range: ${this.formatRangeValue(filter.min)} - ${this.formatRangeValue(filter.max)}`;
    }

    if (field.category === 'TIME_PERIOD' && 'from' in filter) {
      if ('fromYear' in filter && (filter.fromYear !== null || filter.toYear !== null)) {
        return `Range: ${this.formatRangeValue(filter.fromYear)} - ${this.formatRangeValue(filter.toYear)}`;
      }

      return `Range: ${this.formatRangeValue(filter.from)} - ${this.formatRangeValue(filter.to)}`;
    }

    if (field.category === 'IDENTIFIER' && 'operator' in filter) {
      return filter.value ? `${filter.operator}: ${filter.value}` : 'No value entered';
    }

    return 'Not configured';
  }

  protected editFieldCategory(field: PivotField, event: MouseEvent): void {
    event.stopPropagation();
    this.openCategoryDialog(field, (category) => {
      this.updateFieldCategory(field.name, category);
      this.enforceZoneRulesAfterCategoryChange(field.name);
      this.markPending();
    });
  }

  protected formatPivotCell(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    if (typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }

    return String(value);
  }

  protected isTotalPivotRow(row: (string | number | boolean | null)[]): boolean {
    const label = String(row[0] ?? '');
    return label === 'Total' || label.startsWith('Total ') || label.startsWith('Grand ');
  }

  protected isTotalPivotColumn(index: number): boolean {
    const header = this.pivotResult?.headers[index] ?? '';
    return this.isTotalPivotHeader(header);
  }

  protected get canRenderPivotResult(): boolean {
    return this.pivotRenderMetrics.mode !== 'Too Large';
  }

  protected get pivotResultMetadataText(): string {
    if (!this.pivotResult) {
      return 'DuckDB result';
    }

    return [
      `Rows: ${this.formatMetricValue(this.pivotRenderMetrics.rows)}`,
      `Columns: ${this.formatMetricValue(this.pivotRenderMetrics.columns)}`,
      `Mode: ${this.pivotRenderMetrics.mode}`,
    ].join(' | ');
  }

  protected get formattedRenderedCellLimit(): string {
    return this.renderCellThreshold.toLocaleString();
  }

  protected get formattedColumnCombinationLimit(): string {
    return this.hardColumnCombinationThreshold.toLocaleString();
  }

  protected getPivotBodyGridRow(rowIndex: number): string {
    return `${this.cachedPivotHeaderDepth + rowIndex + 1}`;
  }

  protected formatHeaderLabel(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') {
      return '(Blank)';
    }

    return String(value);
  }

  protected formatMetricValue(value: number): string {
    return value.toLocaleString();
  }

  private getPivotHardLimitMessage(estimate: PivotEstimate): string {
    if (estimate.projectedColumns <= this.pivotColumnHardThreshold) {
      return '';
    }

    return [
      `This Pivot would generate approximately ${this.formatMetricValue(estimate.projectedColumns)} columns.`,
      `Maximum supported: ${this.formatMetricValue(this.pivotColumnHardThreshold)} columns.`,
      'Reduce Columns or apply Filters.',
    ].join(' ');
  }

  private getPivotEstimateWarning(estimate: PivotEstimate): string {
    if (estimate.projectedColumns <= this.pivotColumnWarningThreshold) {
      return '';
    }

    return `This Pivot may become difficult to read. Estimated columns: ${this.formatMetricValue(estimate.projectedColumns)}.`;
  }

  private warnIfLikelyHighCardinalityColumn(
    fieldName: string,
    category: ExplorerColumnCategory | null,
    zoneKey: PivotZoneKey | 'availableFields',
  ): void {
    if (zoneKey !== 'columns') {
      return;
    }

    const highCardinalityNamePattern = /(id|uuid|document|number|transaction|material|order)/i;
    if (category === 'IDENTIFIER' || highCardinalityNamePattern.test(fieldName)) {
      this.valuesHelperMessage = 'This field may generate a very large Pivot result.';
    }
  }

  private preparePivotRendering(result: PivotResult | null): void {
    if (!result) {
      this.cachedPivotHeaderCells = [];
      this.cachedPivotHeaderDepth = 1;
      this.displayedPivotRows = [];
      this.pivotRenderMetrics = {
        rows: 0,
        columns: 0,
        cells: 0,
        columnCombinations: 0,
        mode: 'Hierarchical',
      };
      this.pivotGridTemplateColumns = 'repeat(1, minmax(140px, 1fr))';
      return;
    }

    const columns = result.headers.length;
    const columnCombinations = result.pivot?.columnValues?.length ?? 0;
    this.displayedPivotRows = this.buildDisplayPivotRows(result);
    const displayedRows = this.displayedPivotRows.length;
    const dataRows = this.displayedPivotRows.filter((row) => !this.isTotalPivotRow(row)).length;
    const dataColumns = this.countDataPivotColumns(result);
    const cells = displayedRows * columns;
    const mode = this.selectPivotRenderingMode(columnCombinations, cells);

    this.cachedPivotHeaderCells =
      mode === 'Hierarchical'
        ? this.buildHierarchicalHeaderCells(result)
        : mode === 'Compact'
          ? this.buildCompactHeaderCells(result)
          : [];
    this.cachedPivotHeaderDepth =
      this.cachedPivotHeaderCells.length === 0
        ? 1
        : Math.max(...this.cachedPivotHeaderCells.map((cell) => cell.row + cell.rowSpan - 1), 1);
    this.pivotRenderMetrics = {
      rows: dataRows,
      columns: dataColumns,
      cells,
      columnCombinations,
      mode,
    };
    this.pivotGridTemplateColumns = `repeat(${Math.max(result.headers.length, 1)}, minmax(140px, 1fr))`;
  }

  private buildDisplayPivotRows(result: PivotResult): (string | number | boolean | null)[][] {
    const rowFieldCount = result.pivot?.rowFields.length ?? this.getZone('rows').fields.length;
    const valueHeaders = this.getPivotValueHeaders(result, rowFieldCount);
    if (valueHeaders.length === 0 || result.rows.length === 0) {
      return result.rows;
    }

    if (result.pivot?.columnFields.length) {
      return this.buildColumnPivotDisplayRows(result, rowFieldCount, valueHeaders);
    }

    return this.buildFlatPivotDisplayRows(result, rowFieldCount, valueHeaders);
  }

  private buildFlatPivotDisplayRows(
    result: PivotResult,
    rowFieldCount: number,
    valueHeaders: string[],
  ): (string | number | boolean | null)[][] {
    if (result.rows.some((row) => this.isTotalPivotRow(row))) {
      return result.rows;
    }

    const totalRows = valueHeaders.map((valueHeader, valueIndex) => {
      const outputRow = this.createEmptyPivotRow(result.headers.length);
      outputRow[0] = this.getTotalRowLabel(valueHeader, valueHeaders.length > 1);
      for (let index = 1; index < rowFieldCount; index += 1) {
        outputRow[index] = '';
      }
      outputRow[rowFieldCount + valueIndex] = this.calculateDisplayTotal(
        valueHeader,
        result.rows.map((row) => row[rowFieldCount + valueIndex]),
      );
      return outputRow;
    });

    return [...result.rows, ...totalRows];
  }

  private buildColumnPivotDisplayRows(
    result: PivotResult,
    rowFieldCount: number,
    valueHeaders: string[],
  ): (string | number | boolean | null)[][] {
    const totalRowIndex = result.rows.findIndex((row) => this.isTotalPivotRow(row));
    if (totalRowIndex < 0) {
      return result.rows;
    }

    const totalRow = result.rows[totalRowIndex];
    const dataRows = result.rows.filter((_, index) => index !== totalRowIndex);
    if (valueHeaders.length === 1) {
      const relabelledTotalRow = [...totalRow];
      relabelledTotalRow[0] = this.getTotalRowLabel(valueHeaders[0], false);
      return [...dataRows, relabelledTotalRow];
    }

    const splitTotalRows = valueHeaders.map((valueHeader, valueIndex) => {
      const outputRow = this.createEmptyPivotRow(result.headers.length);
      outputRow[0] = this.getTotalRowLabel(valueHeader, true);
      for (let index = 1; index < rowFieldCount; index += 1) {
        outputRow[index] = '';
      }
      for (let columnIndex = rowFieldCount + valueIndex; columnIndex < totalRow.length; columnIndex += valueHeaders.length) {
        outputRow[columnIndex] = totalRow[columnIndex];
      }
      return outputRow;
    });

    return [...dataRows, ...splitTotalRows];
  }

  private countDataPivotColumns(result: PivotResult): number {
    if (result.pivot?.columnFields.length && result.pivot.columnValues.length) {
      return result.pivot.columnValues.length * Math.max(1, result.pivot.valueFields.length);
    }

    const rowFieldCount = result.pivot?.rowFields.length ?? this.getZone('rows').fields.length;
    return result.headers.slice(rowFieldCount).filter((header) => !this.isTotalPivotHeader(header)).length;
  }

  private getPivotValueHeaders(result: PivotResult, rowFieldCount: number): string[] {
    if (result.pivot?.valueFields.length) {
      return result.pivot.valueFields;
    }

    return result.headers.slice(rowFieldCount);
  }

  private createEmptyPivotRow(length: number): (string | number | boolean | null)[] {
    return Array.from({ length }, () => '');
  }

  private calculateDisplayTotal(header: string, values: (string | number | boolean | null)[]): number | string {
    const numericValues = values
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) {
      return '';
    }

    const metricLabel = this.getMetricHeaderLabel(header, [header]);
    if (metricLabel === 'Min') {
      return Math.min(...numericValues);
    }
    if (metricLabel === 'Max') {
      return Math.max(...numericValues);
    }
    if (metricLabel === 'Average' || metricLabel === 'Median') {
      return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    }

    return numericValues.reduce((sum, value) => sum + value, 0);
  }

  private getTotalRowLabel(valueHeader: string, multipleValues: boolean): string {
    const metricLabel = this.getMetricHeaderLabel(valueHeader, [valueHeader]);
    if (metricLabel === 'Sum') {
      return multipleValues ? 'Total Sum' : 'Total';
    }
    if (metricLabel === 'Count') {
      return multipleValues ? 'Total Count' : 'Total';
    }

    return `Grand ${metricLabel}`;
  }

  private selectPivotRenderingMode(columnCombinations: number, cells: number): PivotRenderingMode {
    if (columnCombinations > this.hardColumnCombinationThreshold || cells > this.renderCellThreshold) {
      return 'Too Large';
    }

    if (columnCombinations > this.compactColumnCombinationThreshold) {
      return 'Compact';
    }

    return 'Hierarchical';
  }

  private isTotalPivotHeader(header: string): boolean {
    return header === 'Total' || header.startsWith('Total ') || header.startsWith('Grand ');
  }

  private buildCompactHeaderCells(result: PivotResult): PivotHeaderCell[] {
    const compactLabels = this.buildCompactHeaderLabels(result);
    return compactLabels.map((header, index) => ({
      label: header,
      column: index + 1,
      row: 1,
      columnSpan: 1,
      rowSpan: 1,
      isTotal: this.isTotalPivotHeader(header),
    }));
  }

  private buildCompactHeaderLabels(result: PivotResult): string[] {
    const metadata = result.pivot;
    if (!metadata?.columnFields?.length || !metadata.columnValues.length) {
      return result.headers;
    }

    const rowHeaders = result.headers.slice(0, metadata.rowFields.length);
    const valueHeaders = metadata.valueFields.length > 0 ? metadata.valueFields : ['Value'];
    const valueCount = valueHeaders.length;
    const showMetricLevel = valueHeaders.length > 1;
    const compactHeaders = [...rowHeaders];

    for (const columnValue of metadata.columnValues) {
      const pathParts = columnValue.map((value) => this.formatHeaderLabel(value));
      for (const valueHeader of valueHeaders) {
        compactHeaders.push(
          showMetricLevel
            ? [...pathParts, this.getMetricHeaderLabel(valueHeader, valueHeaders)].join(' / ')
            : pathParts.join(' / '),
        );
      }
    }

    const totalStartIndex = metadata.rowFields.length + metadata.columnValues.length * valueCount;
    compactHeaders.push(...result.headers.slice(totalStartIndex));
    return compactHeaders;
  }

  private buildHierarchicalHeaderCells(result: PivotResult): PivotHeaderCell[] {
    const metadata = result.pivot;
    if (!metadata?.columnFields?.length || !metadata.columnValues.length) {
      return result.headers.map((header, index) => ({
        label: header,
        column: index + 1,
        row: 1,
        columnSpan: 1,
        rowSpan: 1,
        isTotal: this.isTotalPivotHeader(header),
      }));
    }

    const rowFieldCount = metadata.rowFields.length;
    const valueHeaders = metadata.valueFields.length > 0 ? metadata.valueFields : ['Value'];
    const valueCount = valueHeaders.length;
    const showMetricLevel = valueHeaders.length > 1;
    const headerDepth = metadata.columnFields.length + (showMetricLevel ? 1 : 0);
    const cells: PivotHeaderCell[] = [];

    for (let index = 0; index < rowFieldCount; index += 1) {
      cells.push({
        label: result.headers[index] ?? metadata.rowFields[index] ?? '',
        column: index + 1,
        row: 1,
        columnSpan: 1,
        rowSpan: headerDepth,
        isTotal: false,
      });
    }

    for (let level = 0; level < metadata.columnFields.length; level += 1) {
      let groupStart = 0;
      while (groupStart < metadata.columnValues.length) {
        let groupEnd = groupStart + 1;
        while (
          groupEnd < metadata.columnValues.length &&
          this.sameHeaderPrefix(metadata.columnValues[groupStart], metadata.columnValues[groupEnd], level)
        ) {
          groupEnd += 1;
        }

        cells.push({
          label: this.formatHeaderLabel(metadata.columnValues[groupStart][level]),
          column: rowFieldCount + groupStart * valueCount + 1,
          row: level + 1,
          columnSpan: (groupEnd - groupStart) * valueCount,
          rowSpan: 1,
          isTotal: false,
        });

        groupStart = groupEnd;
      }
    }

    if (showMetricLevel) {
      const metricRow = headerDepth;
      metadata.columnValues.forEach((_, combinationIndex) => {
        valueHeaders.forEach((valueHeader, valueIndex) => {
          cells.push({
            label: this.getMetricHeaderLabel(valueHeader, valueHeaders),
            column: rowFieldCount + combinationIndex * valueCount + valueIndex + 1,
            row: metricRow,
            columnSpan: 1,
            rowSpan: 1,
            isTotal: false,
          });
        });
      });
    }

    const firstTotalIndex = rowFieldCount + metadata.columnValues.length * valueCount;
    const totalHeaders = result.headers.slice(firstTotalIndex);
    if (totalHeaders.length > 0) {
      cells.push({
        label: showMetricLevel ? 'Total' : totalHeaders[0],
        column: firstTotalIndex + 1,
        row: 1,
        columnSpan: totalHeaders.length,
        rowSpan: showMetricLevel ? headerDepth - 1 : headerDepth,
        isTotal: true,
      });

      if (showMetricLevel) {
        const metricRow = headerDepth;
        totalHeaders.forEach((header, index) => {
          cells.push({
            label: this.getMetricHeaderLabel(header, totalHeaders),
            column: firstTotalIndex + index + 1,
            row: metricRow,
            columnSpan: 1,
            rowSpan: 1,
            isTotal: true,
          });
        });
      }
    }

    return cells;
  }

  protected clearBuilder(): void {
    if (this.isProcessing) {
      return;
    }

    for (const zone of this.zones) {
      zone.fields = [];
    }
    this.pivotResult = null;
    this.pivotWarnings = [];
    this.hasPendingChanges = false;
    this.valuesHelperMessage = '';
    this.filterHelperMessage = '';
    this.clearPivotState();
  }

  protected applyPivot(): void {
    const activeProject = this.projectSelection.activeProject();
    const datasetId = activeProject?.datasetMetadata?.datasetId;
    if (this.isProcessing || !datasetId || !this.canApplyPivot) {
      return;
    }

    this.isProcessing = true;
    this.valuesHelperMessage = '';
    this.pivotWarnings = [];
    const request = this.createPivotRequest();
    this.importApi.estimatePivot(datasetId, request).subscribe({
      next: (estimate) => {
        const hardLimitMessage = this.getPivotHardLimitMessage(estimate);
        if (hardLimitMessage) {
          this.isProcessing = false;
          this.valuesHelperMessage = hardLimitMessage;
          return;
        }

        const warningMessage = this.getPivotEstimateWarning(estimate);
        if (warningMessage) {
          this.pivotWarnings = [warningMessage];
        }

        this.executePivotRequest(datasetId, request);
      },
      error: () => {
        this.isProcessing = false;
        this.valuesHelperMessage = 'Pivot size could not be estimated.';
      },
    });
  }

  private executePivotRequest(datasetId: string, request: PivotRequest): void {
    const dialogRef = this.dialog.open(PivotProcessingDialog, {
      disableClose: true,
      width: '420px',
    });

    this.importApi.executePivot(datasetId, request).subscribe({
      next: (result) => {
        this.pivotResult = result;
        this.pivotWarnings = [...this.pivotWarnings, ...result.warnings];
        this.hasPendingChanges = false;
        this.isProcessing = false;
        this.savePivotState();
        dialogRef.close();
      },
      error: () => {
        this.isProcessing = false;
        dialogRef.close();
        this.valuesHelperMessage = 'Pivot could not be calculated.';
      },
    });
  }

  protected openSaveTemplateDialog(): void {
    if (this.templates.length >= this.maxTemplates || this.isProcessing) {
      return;
    }

    this.dialog
      .open(SavePivotTemplateDialog, { width: '420px' })
      .afterClosed()
      .subscribe((templateName?: string) => {
        if (!templateName) {
          return;
        }

        this.templateStore.saveTemplate({
          id: crypto.randomUUID(),
          name: templateName,
          config: this.createTemplateConfig(),
        });
        this.templates = this.templateStore.getTemplates();
        this.snackBar.open('Template saved successfully.', 'Close', { duration: 2400 });
      });
  }

  protected openTemplatesDialog(): void {
    this.dialog
      .open(PivotTemplatesDialog, {
        width: '560px',
        data: this.templates,
      })
      .afterClosed()
      .subscribe((result?: { action: 'load'; template: PivotTemplate }) => {
        this.templates = this.templateStore.getTemplates();

        if (result?.action !== 'load') {
          return;
        }

        this.loadTemplate(result.template);
      });
  }

  private loadTemplate(template: PivotTemplate): void {
    for (const zone of this.zones) {
      zone.fields = this.cloneKnownFields(template.config[zone.key] ?? []);
    }

    this.availableFields = this.cloneFields(this.allFields);
    this.sortAvailableFields();
    this.valuesHelperMessage = '';
    this.markPending();
    this.snackBar.open('Template loaded successfully.', 'Close', { duration: 2400 });
  }

  private createTemplateConfig(): Record<PivotZoneKey, PivotField[]> {
    return {
      filters: this.cloneFields(this.getZone('filters').fields),
      rows: this.cloneFields(this.getZone('rows').fields),
      columns: this.cloneFields(this.getZone('columns').fields),
      values: this.cloneFields(this.getZone('values').fields),
    };
  }

  private createPivotRequest(): PivotRequest {
    return {
      rows: this.getZone('rows').fields.map((field) => this.toPivotFieldRequest(field)),
      columns: this.getZone('columns').fields.map((field) => this.toPivotFieldRequest(field)),
      values: this.getZone('values').fields.map((field) => this.toPivotFieldRequest(field)),
      filters: this.getZone('filters')
        .fields.map((field) => field.filter)
        .filter((filter): filter is ExplorerFilterPayload => this.hasActiveFilterValue(filter)),
    };
  }

  private toPivotFieldRequest(field: PivotField) {
    return {
      name: field.name,
      category: field.category,
      aggregation: this.normaliseAggregation(field, field.aggregation),
    };
  }

  private normaliseAggregation(field: PivotField, aggregation: string | undefined): string {
    const aggregations = this.getAggregations(field);
    if (aggregation && aggregations.includes(aggregation)) {
      return aggregation;
    }

    return field.category === 'AMOUNT' ? 'Sum' : 'Count';
  }

  private sameHeaderPrefix(
    left: (string | number | boolean | null)[],
    right: (string | number | boolean | null)[],
    level: number,
  ): boolean {
    for (let index = 0; index <= level; index += 1) {
      if (String(left[index] ?? '') !== String(right[index] ?? '')) {
        return false;
      }
    }

    return true;
  }

  private getMetricHeaderLabel(header: string, headers: string[]): string {
    const aggregations = [...this.amountAggregations, ...this.discreteAggregations].sort(
      (left, right) => right.length - left.length,
    );
    const aggregation = aggregations.find((item) => header.endsWith(` ${item}`));

    if (!aggregation) {
      return header;
    }

    const baseNames = headers.map((item) =>
      aggregations.reduce((name, candidate) => {
        return name.endsWith(` ${candidate}`) ? name.slice(0, -candidate.length - 1) : name;
      }, item),
    );
    const hasMultipleValueFields = new Set(baseNames).size > 1;

    return hasMultipleValueFields ? header : aggregation;
  }

  private markPending(): void {
    this.hasPendingChanges = true;
    this.savePivotState();
  }

  private openFilterDialog(
    field: PivotField,
    metadata: ExplorerFilterMetadata,
    options: { removeOnCancel?: boolean } = {},
  ): void {
    if (field.category === 'TYPE_VARIANT') {
      this.openTypeVariantFilterDialog(field, metadata, options);
    } else if (field.category === 'AMOUNT') {
      this.openAmountFilterDialog(field, metadata, options);
    } else if (field.category === 'TIME_PERIOD') {
      this.openTimeFilterDialog(field, metadata, options);
    } else if (field.category === 'IDENTIFIER') {
      this.openIdentifierFilterDialog(field, options);
    }
  }

  private openTypeVariantFilterDialog(
    field: PivotField,
    metadata: ExplorerFilterMetadata,
    options: { removeOnCancel?: boolean } = {},
  ): void {
    const currentValues =
      field.filter && 'values' in field.filter ? field.filter.values.map((value) => String(value)) : [];
    this.dialog
      .open(PivotTypeFilterDialog, {
        width: '500px',
        data: {
          fieldName: field.name,
          values: metadata.values ?? [],
          selectedValues: currentValues,
        },
      })
      .afterClosed()
      .subscribe((values?: string[]) => {
        if (!values) {
          this.handleFilterConfigurationCancel(field, options);
          return;
        }

        field.filter = {
          columnName: field.name,
          category: 'TYPE_VARIANT',
          values,
        };
        this.markPending();
      });
  }

  private openAmountFilterDialog(
    field: PivotField,
    metadata: ExplorerFilterMetadata,
    options: { removeOnCancel?: boolean } = {},
  ): void {
    const currentFilter = field.filter && 'min' in field.filter ? field.filter : null;
    this.dialog
      .open(PivotAmountFilterDialog, {
        width: '460px',
        data: {
          fieldName: field.name,
          minimum: this.toNullableNumber(metadata.min),
          maximum: this.toNullableNumber(metadata.max),
          currentMin: currentFilter?.min ?? null,
          currentMax: currentFilter?.max ?? null,
        },
      })
      .afterClosed()
      .subscribe((range?: { min: number | null; max: number | null }) => {
        if (!range) {
          this.handleFilterConfigurationCancel(field, options);
          return;
        }

        field.filter = {
          columnName: field.name,
          category: 'AMOUNT',
          min: range.min,
          max: range.max,
        };
        this.markPending();
      });
  }

  private openTimeFilterDialog(
    field: PivotField,
    metadata: ExplorerFilterMetadata,
    options: { removeOnCancel?: boolean } = {},
  ): void {
    const currentFilter =
      field.filter && 'from' in field.filter && 'fromYear' in field.filter ? field.filter : null;
    this.dialog
      .open(PivotTimeFilterDialog, {
        width: '460px',
        data: {
          fieldName: field.name,
          isDate: metadata.type === 'Date',
          from: metadata.from ?? null,
          to: metadata.to ?? null,
          minimum: this.toNullableNumber(metadata.min),
          maximum: this.toNullableNumber(metadata.max),
          currentFrom: currentFilter?.from ?? null,
          currentTo: currentFilter?.to ?? null,
          currentFromYear: currentFilter?.fromYear ?? null,
          currentToYear: currentFilter?.toYear ?? null,
        },
      })
      .afterClosed()
      .subscribe(
        (
          range?:
            | {
                from: string | null;
                to: string | null;
                fromYear: number | null;
                toYear: number | null;
              }
            | undefined,
        ) => {
          if (!range) {
            this.handleFilterConfigurationCancel(field, options);
            return;
          }

          field.filter = {
            columnName: field.name,
            category: 'TIME_PERIOD',
            from: range.from,
            to: range.to,
            fromYear: range.fromYear,
            toYear: range.toYear,
          };
          this.markPending();
        },
      );
  }

  private openIdentifierFilterDialog(
    field: PivotField,
    options: { removeOnCancel?: boolean } = {},
  ): void {
    const currentFilter = field.filter && 'operator' in field.filter ? field.filter : null;
    this.dialog
      .open(PivotIdentifierFilterDialog, {
        width: '460px',
        data: {
          fieldName: field.name,
          operator: (currentFilter?.operator as IdentifierOperator | undefined) ?? 'Contains',
          value: currentFilter?.value ?? '',
        },
      })
      .afterClosed()
      .subscribe((filter?: { operator: IdentifierOperator; value: string }) => {
        if (!filter) {
          this.handleFilterConfigurationCancel(field, options);
          return;
        }

        field.filter = {
          columnName: field.name,
          category: 'IDENTIFIER',
          operator: filter.operator,
          value: filter.value,
        };
        this.markPending();
      });
  }

  private handleFilterConfigurationCancel(
    field: PivotField,
    options: { removeOnCancel?: boolean },
  ): void {
    if (!options.removeOnCancel || field.filter) {
      return;
    }

    const filtersZone = this.getZone('filters');
    filtersZone.fields = filtersZone.fields.filter((zoneField) => zoneField !== field);
    this.markPending();
  }

  private moveFieldByName(
    fieldName: string,
    targetZoneKey: PivotZoneKey | 'availableFields',
    sourceZoneKey: PivotZoneKey | 'availableFields',
    sourceIndex: number,
    targetIndex?: number,
  ): void {
    const shouldCopyFromSourceList = sourceZoneKey === 'availableFields';
    const field = shouldCopyFromSourceList
      ? this.availableFields.find((availableField) => availableField.name === fieldName)
      : this.removeFieldFromLocation(sourceZoneKey, sourceIndex);
    if (!field) {
      return;
    }

    if (targetZoneKey === 'availableFields') {
      field.aggregation = undefined;
      field.filter = undefined;
      this.markPending();
      return;
    }

    const targetZone = this.getZone(targetZoneKey);
    if (
      targetZoneKey !== 'values' &&
      targetZone.fields.some((zoneField) => zoneField.name === fieldName)
    ) {
      if (sourceZoneKey !== 'availableFields') {
        this.getZone(sourceZoneKey).fields.splice(sourceIndex, 0, field);
      }
      this.valuesHelperMessage = `${fieldName} is already used in ${targetZone.label}.`;
      return;
    }

    const fieldForTarget = shouldCopyFromSourceList ? { ...field } : field;
    if (targetZoneKey === 'values') {
      fieldForTarget.aggregation = this.normaliseAggregation(fieldForTarget, fieldForTarget.aggregation);
      fieldForTarget.filter = undefined;
    } else {
      fieldForTarget.aggregation = undefined;
      if (targetZoneKey !== 'filters') {
        fieldForTarget.filter = undefined;
      }
    }

    targetZone.fields.splice(targetIndex ?? targetZone.fields.length, 0, fieldForTarget);
    this.markPending();
    if (targetZoneKey === 'filters') {
      this.configureFilter(fieldForTarget, { removeOnCancel: true });
    }
  }

  private removeFieldFromLocation(
    sourceZoneKey: PivotZoneKey,
    sourceIndex: number,
  ): PivotField | null {
    const sourceZone = this.getZone(sourceZoneKey);
    const [field] = sourceZone.fields.splice(sourceIndex, 1);
    return field ?? null;
  }

  private returnFieldToAvailable(field: PivotField): void {
    field.aggregation = undefined;
    field.filter = undefined;
  }

  private openCategoryDialog(
    field: PivotField,
    onCategorySelected: (category: ExplorerColumnCategory | null) => void,
  ): void {
    this.dialog
      .open(ColumnCategoryDialog, {
        width: '460px',
        data: {
          columnName: field.name,
          category: field.category,
          sampleValues: [],
        },
      })
      .afterClosed()
      .subscribe((category?: ExplorerColumnCategory | 'CLEAR') => {
        if (!category) {
          return;
        }

        onCategorySelected(category === 'CLEAR' ? null : category);
      });
  }

  private updateFieldCategory(fieldName: string, category: ExplorerColumnCategory | null): void {
    this.allFields = this.allFields.map((field) =>
      field.name === fieldName ? { ...field, category } : field,
    );
    this.availableFields = this.availableFields.map((field) =>
      field.name === fieldName ? { ...field, category } : field,
    );
    for (const zone of this.zones) {
      zone.fields = zone.fields.map((field) => {
        if (field.name !== fieldName) {
          return field;
        }

        return { ...field, category, filter: field.category === category ? field.filter : undefined };
      });
    }
    this.saveExplorerCategories();
  }

  private enforceZoneRulesAfterCategoryChange(fieldName: string): void {
    const valueField = this.getZone('values').fields.find((field) => field.name === fieldName);
    if (valueField) {
      valueField.aggregation = this.normaliseAggregation(valueField, valueField.aggregation);
    }

    for (const zone of this.zones) {
      const uncategorizedField = zone.fields.find((field) => field.name === fieldName && !field.category);
      if (uncategorizedField) {
        zone.fields = zone.fields.filter((field) => field.name !== fieldName);
        uncategorizedField.aggregation = undefined;
        uncategorizedField.filter = undefined;
        this.valuesHelperMessage = 'Assign a category before using a field in the Pivot Builder.';
      }
    }
  }

  private hasActiveFilterValue(filter: ExplorerFilterPayload | undefined): filter is ExplorerFilterPayload {
    if (!filter) {
      return false;
    }

    if ('values' in filter) {
      return filter.values.length > 0;
    }

    if ('min' in filter && 'max' in filter) {
      return filter.min !== null || filter.max !== null;
    }

    if ('from' in filter && 'to' in filter) {
      return (
        Boolean(filter.from) ||
        Boolean(filter.to) ||
        ('fromYear' in filter && (filter.fromYear !== null || filter.toYear !== null))
      );
    }

    if ('value' in filter) {
      return filter.value.trim().length > 0;
    }

    return false;
  }

  private formatRangeValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return 'Any';
    }

    return String(value);
  }

  private toNullableNumber(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private sortAvailableFields(): void {
    this.availableFields.sort((a, b) => a.name.localeCompare(b.name));
  }

  private cloneFields(fields: PivotField[]): PivotField[] {
    return fields.map((field) => ({ ...field }));
  }

  private cloneKnownFields(fields: PivotField[]): PivotField[] {
    const availableFieldMap = new Map(this.allFields.map((field) => [field.name, field]));
    const knownFields: PivotField[] = [];

    for (const field of fields) {
      const knownField = availableFieldMap.get(field.name);
      if (knownField) {
        knownFields.push({ ...knownField, aggregation: field.aggregation, filter: field.filter });
      }
    }

    return knownFields;
  }

  private loadDatasetFields(): void {
    const activeProject = this.projectSelection.activeProject();
    const datasetId = activeProject?.datasetMetadata?.datasetId;
    this.fieldErrorMessage = '';

    if (!datasetId) {
      this.allFields = [];
      this.availableFields = [];
      this.fieldErrorMessage = 'Open a project created from uploaded files to configure a pivot.';
      this.resetPivotConfiguration();
      return;
    }

    this.isLoadingFields = true;
    this.importApi.getDatasetOverview(datasetId).subscribe({
      next: (overview) => {
        const categories = this.loadExplorerCategories(activeProject.id);
        this.allFields = overview.columns.map((column) => ({
          name: column.name,
          type: this.toPivotFieldType(column.type),
          dataType: column.type,
          category: categories[column.name] ?? null,
          distinctCount: column.distinctCount,
        }));
        this.restorePivotState(activeProject.id);
        this.isLoadingFields = false;
      },
      error: () => {
        this.allFields = [];
        this.availableFields = [];
        this.isLoadingFields = false;
        this.fieldErrorMessage = 'Dataset fields could not be loaded.';
      },
    });
  }

  private loadExplorerCategories(projectId: string): Record<string, ExplorerColumnCategory> {
    try {
      return JSON.parse(localStorage.getItem(`${this.categoryStoragePrefix}:${projectId}`) ?? '{}');
    } catch {
      return {};
    }
  }

  private saveExplorerCategories(): void {
    const activeProject = this.projectSelection.activeProject();
    if (!activeProject) {
      return;
    }

    const categories = Object.fromEntries(
      this.allFields
        .filter((field): field is PivotField & { category: ExplorerColumnCategory } => field.category !== null)
        .map((field) => [field.name, field.category]),
    );
    localStorage.setItem(`${this.categoryStoragePrefix}:${activeProject.id}`, JSON.stringify(categories));
  }

  private resetPivotConfiguration(): void {
    for (const zone of this.zones) {
      zone.fields = [];
    }

    this.availableFields = this.cloneFields(this.allFields);
    this.sortAvailableFields();
    this.pivotResult = null;
    this.pivotWarnings = [];
    this.hasPendingChanges = false;
    this.valuesHelperMessage = '';
    this.filterHelperMessage = '';
  }

  private restorePivotState(projectId: string): void {
    const state = this.loadPivotState(projectId);
    if (!state) {
      this.resetPivotConfiguration();
      return;
    }

    for (const zone of this.zones) {
      zone.fields = this.cloneKnownFields(state.config[zone.key] ?? []);
    }
    this.availableFields = this.cloneFields(this.allFields);
    this.sortAvailableFields();
    this.pivotResult = state.pivotResult;
    this.pivotWarnings = state.pivotWarnings ?? [];
    this.hasPendingChanges = state.hasPendingChanges;
    this.valuesHelperMessage = '';
    this.filterHelperMessage = '';
  }

  private loadPivotState(projectId: string): PersistedPivotState | null {
    try {
      return JSON.parse(localStorage.getItem(this.getPivotStateStorageKey(projectId)) ?? 'null');
    } catch {
      return null;
    }
  }

  private savePivotState(): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId || this.allFields.length === 0) {
      return;
    }

    const state: PersistedPivotState = {
      config: this.createTemplateConfig(),
      pivotResult: this.pivotResult,
      pivotWarnings: this.pivotWarnings,
      hasPendingChanges: this.hasPendingChanges,
    };
    localStorage.setItem(this.getPivotStateStorageKey(projectId), JSON.stringify(state));
  }

  private clearPivotState(): void {
    const projectId = this.projectSelection.activeProject()?.id;
    if (!projectId) {
      return;
    }

    localStorage.removeItem(this.getPivotStateStorageKey(projectId));
  }

  private getPivotStateStorageKey(projectId: string): string {
    return `${this.pivotStateStoragePrefix}:${projectId}`;
  }

  private toPivotFieldType(dataType: DetectedColumnType): PivotFieldType {
    if (dataType === 'Integer' || dataType === 'Decimal') {
      return 'number';
    }

    if (dataType === 'Date') {
      return 'date';
    }

    if (dataType === 'Boolean') {
      return 'boolean';
    }

    return 'text';
  }
}
