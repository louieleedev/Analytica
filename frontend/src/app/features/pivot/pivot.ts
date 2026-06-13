import { Component, Injectable, inject } from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

type PivotFieldType = 'text' | 'number' | 'date';
type PivotZoneKey = 'filters' | 'rows' | 'columns' | 'values';

type PivotField = {
  name: string;
  type: PivotFieldType;
  group: 'Dimensions' | 'Dates' | 'Measures';
  aggregation?: string;
};

type PivotZone = {
  key: PivotZoneKey;
  label: string;
  icon: string;
  helper: string;
  fields: PivotField[];
};

type PivotResult = {
  headers: string[];
  rows: string[][];
};

type PivotTemplate = {
  id: string;
  name: string;
  config: Record<PivotZoneKey, PivotField[]>;
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
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './pivot.html',
})
export class Pivot {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly templateStore = inject(PivotTemplateStore);
  private dialogRef?: MatDialogRef<PivotProcessingDialog>;

  protected readonly maxTemplates = 4;
  protected templates: PivotTemplate[] = this.templateStore.getTemplates();
  protected isProcessing = false;
  protected hasPendingChanges = false;
  protected valuesHelperMessage = '';
  protected readonly aggregations = ['Sum', 'Count', 'Average', 'Min', 'Max', 'Distinct Count'];

  private readonly allFields: PivotField[] = [
    { name: 'CompanyCode', type: 'text', group: 'Dimensions' },
    { name: 'Country', type: 'text', group: 'Dimensions' },
    { name: 'Currency', type: 'text', group: 'Dimensions' },
    { name: 'CostCenter', type: 'text', group: 'Dimensions' },
    { name: 'GLAccount', type: 'text', group: 'Dimensions' },
    { name: 'FiscalYear', type: 'date', group: 'Dates' },
    { name: 'Quarter', type: 'date', group: 'Dates' },
    { name: 'PostingDate', type: 'date', group: 'Dates' },
    { name: 'AmountLocal', type: 'number', group: 'Measures' },
    { name: 'Quantity', type: 'number', group: 'Measures' },
    { name: 'TaxAmount', type: 'number', group: 'Measures' },
    { name: 'Revenue', type: 'number', group: 'Measures' },
  ];

  protected availableFields: PivotField[] = this.cloneFields(this.allFields);

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
      helper: 'Numeric measures only',
      fields: [],
    },
  ];

  protected pivotResult: PivotResult = this.generateMockResult();

  protected get connectedDropLists(): string[] {
    return ['availableFields', ...this.zones.map((zone) => zone.key)];
  }

  protected get groupedAvailableFields(): { label: string; fields: PivotField[] }[] {
    return ['Dimensions', 'Dates', 'Measures'].map((label) => ({
      label,
      fields: this.availableFields.filter((field) => field.group === label),
    }));
  }

  protected getZone(key: PivotZoneKey): PivotZone {
    return this.zones.find((zone) => zone.key === key)!;
  }

  protected drop(event: CdkDragDrop<PivotField[]>, zoneKey: PivotZoneKey | 'availableFields'): void {
    if (this.isProcessing) {
      return;
    }

    this.valuesHelperMessage = '';
    const field = event.item.data as PivotField;

    if (zoneKey === 'values' && field.type !== 'number') {
      this.valuesHelperMessage = 'Only numeric columns can be used as Values.';
      return;
    }

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
    }

    if (zoneKey === 'values') {
      field.aggregation ??= 'Sum';
    }

    if (zoneKey === 'availableFields') {
      field.aggregation = undefined;
      this.sortAvailableFields();
    }

    this.markPending();
  }

  protected removeField(zone: PivotZone, field: PivotField): void {
    if (this.isProcessing) {
      return;
    }

    zone.fields = zone.fields.filter((zoneField) => zoneField.name !== field.name);
    field.aggregation = undefined;
    this.availableFields.push(field);
    this.sortAvailableFields();
    this.markPending();
  }

  protected updateAggregation(field: PivotField, aggregation: string): void {
    field.aggregation = aggregation;
    this.markPending();
  }

  protected applyPivot(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.dialogRef = this.dialog.open(PivotProcessingDialog, {
      disableClose: true,
      width: '420px',
    });

    // TODO: Replace this delay with a FastAPI request that triggers DuckDB aggregation.
    window.setTimeout(() => {
      this.pivotResult = this.generateMockResult();
      this.hasPendingChanges = false;
      this.isProcessing = false;
      this.dialogRef?.close();
    }, 1000);
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
      zone.fields = this.cloneFields(template.config[zone.key] ?? []);
    }

    const usedFieldNames = new Set(this.zones.flatMap((zone) => zone.fields.map((field) => field.name)));
    this.availableFields = this.cloneFields(this.allFields.filter((field) => !usedFieldNames.has(field.name)));
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

  private markPending(): void {
    this.hasPendingChanges = true;
  }

  private sortAvailableFields(): void {
    this.availableFields.sort((a, b) => a.name.localeCompare(b.name));
  }

  private cloneFields(fields: PivotField[]): PivotField[] {
    return fields.map((field) => ({ ...field }));
  }

  private generateMockResult(): PivotResult {
    // TODO: Future implementation will use FastAPI endpoints for real filtering and pivot generation.
    // TODO: DuckDB will calculate real aggregations for the configured rows, columns, filters, and values.
    const rowFields = this.getZone('rows').fields.map((field) => field.name);
    const columnFields = this.getZone('columns').fields.map((field) => field.name);
    const valueFields = this.getZone('values').fields.map((field) => field.name);

    const rowHeader = rowFields.length > 0 ? rowFields.join(' / ') : 'Rows';
    const columnHeaders =
      columnFields.length > 0 ? ['2023', '2024', '2025'] : valueFields.map((field) => field);

    const headers = [rowHeader, ...columnHeaders];
    const rowLabels = this.buildRowLabels(rowFields);

    const rows = rowLabels.map((label, rowIndex) => [
      label,
      ...columnHeaders.map((_, columnIndex) =>
        this.formatMockValue((rowIndex + 1) * (columnIndex + 2) * 184250),
      ),
    ]);

    rows.push(['Total', ...columnHeaders.map((_, columnIndex) => this.formatMockValue((columnIndex + 5) * 720000))]);

    return { headers, rows };
  }

  private buildRowLabels(rowFields: string[]): string[] {
    if (rowFields.includes('Country') && rowFields.includes('CostCenter')) {
      return ['Germany / CC-120', 'Germany / CC-330', 'United States / CC-210', 'France / CC-180'];
    }

    if (rowFields.includes('Country')) {
      return ['Germany', 'United States', 'France', 'Japan'];
    }

    if (rowFields.includes('CostCenter')) {
      return ['CC-120', 'CC-210', 'CC-330', 'CC-180'];
    }

    if (rowFields.length > 0) {
      return [`${rowFields[0]} A`, `${rowFields[0]} B`, `${rowFields[0]} C`];
    }

    return ['All Records'];
  }

  private formatMockValue(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
}
