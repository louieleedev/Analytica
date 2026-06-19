import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ImportApi } from '../../core/import-api';
import {
  DatasetFileType,
  DatasetManagedFile,
  DatasetManagementSummary,
  ImportMethod,
} from '../../core/import-workflow.models';
import { ProjectSelection } from '../../core/project-selection';

@Component({
  selector: 'app-delete-dataset-file-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Delete File</h2>
    <mat-dialog-content>
      <p>Remove this file from the logical dataset?</p>
      <p>This updates dataset metadata and downstream analytics.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
})
export class DeleteDatasetFileDialog {}

@Component({
  selector: 'app-datasets',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './datasets.html',
})
export class Datasets {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('folderInput') private folderInput?: ElementRef<HTMLInputElement>;

  private readonly importApi = inject(ImportApi);
  protected readonly projectSelection = inject(ProjectSelection);
  private readonly dialog = inject(MatDialog);
  private loadedDatasetId: string | null = null;

  protected readonly dataset = signal<DatasetManagementSummary | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly isUploading = signal(false);
  protected readonly deletingFileId = signal<string | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected selectedFileType: DatasetFileType = 'CSV';

  protected readonly activeDatasetId = computed(
    () => this.projectSelection.activeProject()?.datasetMetadata?.datasetId ?? null,
  );

  protected readonly metrics = computed(() => {
    const summary = this.dataset()?.summary;
    return [
      {
        label: 'Total Files',
        value: summary ? this.formatNumber(summary.totalFiles) : '-',
        icon: 'upload_file',
      },
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
        label: 'Dataset Size',
        value: summary ? this.formatBytes(summary.datasetSize) : '-',
        icon: 'database',
      },
      {
        label: 'Last Import',
        value: summary?.lastImportTimestamp ? this.formatDate(summary.lastImportTimestamp) : '-',
        icon: 'schedule',
      },
      {
        label: 'Last File',
        value: summary?.lastImportedFile ?? '-',
        icon: 'description',
      },
      {
        label: 'Schema Mode',
        value: this.dataset() ? (this.dataset()?.hasHeaders ? 'Headers Included' : 'Manual Schema') : '-',
        icon: 'view_week',
      },
    ];
  });

  constructor() {
    console.info('REAL DATASETS PAGE LOADED');

    effect(() => {
      const datasetId = this.activeDatasetId();
      if (datasetId === this.loadedDatasetId) {
        return;
      }

      this.loadedDatasetId = datasetId;
      this.loadDataset();
    });
  }

  protected loadDataset(): void {
    const datasetId = this.activeDatasetId();
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!datasetId) {
      this.dataset.set(null);
      this.errorMessage.set('Open a project created from uploaded files to manage datasets.');
      return;
    }

    this.isLoading.set(true);
    this.importApi.getDatasetManagementSummary(datasetId).subscribe({
      next: (summary) => {
        this.dataset.set(summary);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(this.readErrorMessage(error));
      },
    });
  }

  protected selectFileType(fileType: DatasetFileType): void {
    this.selectedFileType = fileType;
  }

  protected openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  protected openFolderPicker(): void {
    this.folderInput?.nativeElement.click();
  }

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFiles('files', Array.from(input.files ?? []));
    input.value = '';
  }

  protected onFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFiles('folder', Array.from(input.files ?? []));
    input.value = '';
  }

  protected deleteFile(file: DatasetManagedFile): void {
    const datasetId = this.activeDatasetId();
    if (!datasetId || this.deletingFileId()) {
      return;
    }

    this.dialog
      .open(DeleteDatasetFileDialog, {
        width: '420px',
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.deletingFileId.set(file.id);
        this.errorMessage.set('');
        this.successMessage.set('');
        this.importApi.deleteDatasetFile(datasetId, file.id).subscribe({
          next: (summary) => {
            this.dataset.set(summary);
            this.projectSelection.loadProjects();
            this.deletingFileId.set(null);
            this.successMessage.set(`${file.name} was removed from the dataset.`);
          },
          error: (error: HttpErrorResponse) => {
            this.deletingFileId.set(null);
            this.errorMessage.set(this.readErrorMessage(error));
          },
        });
      });
  }

  protected formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    return value.toLocaleString();
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

  protected formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private uploadFiles(importMethod: ImportMethod, files: File[]): void {
    const datasetId = this.activeDatasetId();
    if (!datasetId) {
      this.errorMessage.set('Open a project before adding files.');
      return;
    }

    if (!files.length) {
      return;
    }

    this.isUploading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.importApi.appendDatasetFiles(datasetId, importMethod, this.selectedFileType, files).subscribe({
      next: (summary) => {
        this.dataset.set(summary);
        this.projectSelection.loadProjects();
        this.isUploading.set(false);
        this.successMessage.set(`${files.length.toLocaleString()} file${files.length === 1 ? '' : 's'} added.`);
      },
      error: (error: HttpErrorResponse) => {
        this.isUploading.set(false);
        this.errorMessage.set(this.readErrorMessage(error));
      },
    });
  }

  private readErrorMessage(error: HttpErrorResponse): string {
    if (typeof error.error?.detail === 'string') {
      return error.error.detail;
    }

    if (typeof error.error === 'string') {
      return error.error;
    }

    return 'The dataset operation could not be completed.';
  }
}
