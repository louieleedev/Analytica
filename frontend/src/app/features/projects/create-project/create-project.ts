import { HttpErrorResponse } from '@angular/common/http';
import { AfterViewInit, Component, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { Observable, map } from 'rxjs';

import { ImportApi } from '../../../core/import-api';
import { DatasetFileType, ImportMethod, ImportPreview } from '../../../core/import-workflow.models';
import { ProjectDraft, ProjectSelection } from '../../../core/project-selection';

type DiscardDialogAction = 'cancel' | 'draft' | 'discard';

@Component({
  selector: 'app-discard-project-creation-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Discard Project Creation?</h2>
    <mat-dialog-content>
      <p>You have an unfinished project creation process.</p>
      <p>Do you want to discard the current project or save it as a draft?</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="'cancel'">Cancel</button>
      <button mat-button type="button" [mat-dialog-close]="'draft'">Save as Draft and Exit</button>
      <button mat-flat-button type="button" [mat-dialog-close]="'discard'">Discard</button>
    </mat-dialog-actions>
  `,
})
export class DiscardProjectCreationDialog {}

@Component({
  selector: 'app-create-project',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatStepperModule,
  ],
  templateUrl: './create-project.html',
})
export class CreateProject implements OnInit, AfterViewInit {
  @ViewChild(MatStepper) private stepper?: MatStepper;

  private readonly importApi = inject(ImportApi);
  private readonly projectSelection = inject(ProjectSelection);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  protected projectName = '';
  protected description = '';
  protected currentStep = 0;
  protected draftId: string | null = null;
  protected importMethod: ImportMethod = 'files';
  protected selectedFileType: DatasetFileType = 'CSV';
  protected selectedFiles: File[] = [];
  protected selectedFolderFiles: File[] = [];
  protected selectedFolderPath = '';
  protected importPreview: ImportPreview | null = null;
  protected validationError = '';
  protected isValidating = false;
  private allowNavigation = false;

  ngOnInit(): void {
    this.draftId = this.route.snapshot.paramMap.get('draftId');
    if (!this.draftId) {
      return;
    }

    const draftProject = this.projectSelection.findProject(this.draftId);
    if (draftProject?.draft) {
      this.restoreDraft(draftProject.draft);
    }
  }

  ngAfterViewInit(): void {
    this.syncStepperIndex();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  canDeactivate(): boolean | Observable<boolean> {
    if (this.allowNavigation || !this.hasUnsavedChanges()) {
      return true;
    }

    return this.dialog
      .open(DiscardProjectCreationDialog, {
        width: '460px',
        disableClose: true,
      })
      .afterClosed()
      .pipe(
        map((action?: DiscardDialogAction) => {
          if (action === 'draft') {
            if (!this.saveDraft()) {
              return false;
            }
            this.allowNavigation = true;
            return true;
          }

          if (action === 'discard') {
            if (this.draftId) {
              this.projectSelection.deleteProject(this.draftId);
            }
            this.allowNavigation = true;
            return true;
          }

          return false;
        }),
      );
  }

  protected get activeFiles(): File[] {
    return this.importMethod === 'files' ? this.selectedFiles : this.selectedFolderFiles;
  }

  protected get hasDataSelection(): boolean {
    return this.activeFiles.length > 0;
  }

  protected get fileAccept(): string {
    return this.selectedFileType === 'CSV' ? '.csv' : '.xlsx';
  }

  protected get projectNameValidationMessage(): string {
    return this.isDuplicateProjectName()
      ? 'A project with this name already exists. Please choose a different project name.'
      : '';
  }

  protected isProjectInfoValid(projectName: string, description: string): boolean {
    return (
      projectName.trim().length > 0 &&
      description.trim().length > 0 &&
      !this.isDuplicateProjectName(projectName)
    );
  }

  protected goToStep(step: number): void {
    this.setCurrentStep(step, 'Continue clicked');
  }

  protected previousStep(): void {
    const currentStep = this.stepper?.selectedIndex ?? this.currentStep;
    const targetStep = Math.max(0, currentStep - 1);

    console.info('Back clicked', {
      currentStep,
      targetStep,
      wizardState: this.createLoggableWizardState(),
    });

    this.setCurrentStep(targetStep, 'Back clicked', currentStep);
  }

  protected onStepperIndexChange(step: number): void {
    if (step === this.currentStep) {
      return;
    }

    console.info('Create Project stepper index changed', {
      currentStep: this.currentStep,
      targetStep: step,
      wizardState: this.createLoggableWizardState(),
    });

    this.currentStep = step;
  }

  protected selectImportMethod(importMethod: ImportMethod): void {
    if (this.importMethod === importMethod) {
      return;
    }

    this.importMethod = importMethod;
    this.importPreview = null;
    this.validationError = '';
  }

  protected selectFileType(fileType: DatasetFileType): void {
    this.selectedFileType = fileType;
    this.selectedFiles = [];
    this.importPreview = null;
    this.validationError = '';
  }

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFiles = this.appendUniqueFiles(this.selectedFiles, Array.from(input.files ?? []));
    this.importPreview = null;
    this.validationError = '';
    input.value = '';
  }

  protected onFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFolderFiles = Array.from(input.files ?? []);
    this.selectedFolderPath = this.getSelectedFolderPath(this.selectedFolderFiles);
    this.importPreview = null;
    this.validationError = '';
    input.value = '';
  }

  protected removeSelectedFile(file: File): void {
    this.selectedFiles = this.selectedFiles.filter((selectedFile) => this.fileKey(selectedFile) !== this.fileKey(file));
    this.importPreview = null;
    this.validationError = '';
  }

  protected removeSelectedFolderFile(file: File): void {
    this.selectedFolderFiles = this.selectedFolderFiles.filter(
      (selectedFile) => this.fileKey(selectedFile) !== this.fileKey(file),
    );
    this.selectedFolderPath = this.getSelectedFolderPath(this.selectedFolderFiles);
    this.importPreview = null;
    this.validationError = '';
  }

  protected validateDataSelection(): void {
    if (!this.hasDataSelection) {
      this.validationError =
        this.importMethod === 'files' ? 'Select at least one file.' : 'Select a folder containing CSV or XLSX files.';
      return;
    }

    this.isValidating = true;
    this.validationError = '';

    this.importApi
      .createImportPreview(this.importMethod, this.selectedFileType, this.activeFiles)
      .subscribe({
        next: (preview) => {
          this.importPreview = preview;
          this.isValidating = false;
          this.goToStep(2);
        },
        error: (error: HttpErrorResponse) => {
          this.importPreview = null;
          this.isValidating = false;
          this.validationError = this.readErrorMessage(error);
        },
      });
  }

  protected createProject(): void {
    if (!this.isProjectInfoValid(this.projectName, this.description) || !this.importPreview) {
      if (this.isDuplicateProjectName()) {
        this.validationError = this.projectNameValidationMessage;
      }
      return;
    }

    if (this.draftId) {
      this.projectSelection.activateDraft(
        this.draftId,
        this.projectName.trim(),
        this.description.trim(),
        this.importPreview,
      );
    } else {
      this.projectSelection.createProject(this.projectName.trim(), this.description.trim(), this.importPreview);
    }

    this.allowNavigation = true;
    this.router.navigate(['/projects']);
  }

  protected formatSize(size: number): string {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected formatCellValue(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    return String(value);
  }

  private saveDraft(): boolean {
    if (this.isDuplicateProjectName()) {
      this.validationError = this.projectNameValidationMessage;
      this.currentStep = 0;
      return false;
    }

    const draftProject = this.projectSelection.saveDraft(this.createDraftSnapshot(), this.draftId ?? undefined);
    this.draftId = draftProject.id;
    return true;
  }

  private createDraftSnapshot(): ProjectDraft {
    return {
      projectName: this.projectName,
      description: this.description,
      currentStep: this.currentStep,
      importMethod: this.importMethod,
      selectedFileType: this.selectedFileType,
      selectedFiles: this.selectedFiles,
      selectedFolderFiles: this.selectedFolderFiles,
      selectedFolderPath: this.selectedFolderPath,
      importPreview: this.importPreview,
    };
  }

  private restoreDraft(draft: ProjectDraft): void {
    this.projectName = draft.projectName;
    this.description = draft.description;
    this.currentStep = draft.currentStep;
    this.importMethod = draft.importMethod;
    this.selectedFileType = draft.selectedFileType;
    this.selectedFiles = draft.selectedFiles;
    this.selectedFolderFiles = draft.selectedFolderFiles;
    this.selectedFolderPath = draft.selectedFolderPath;
    this.importPreview = draft.importPreview;
    this.syncStepperIndex();
  }

  private isDuplicateProjectName(projectName = this.projectName): boolean {
    return this.projectSelection.isProjectNameTaken(projectName, this.draftId ?? undefined);
  }

  private appendUniqueFiles(existingFiles: File[], newFiles: File[]): File[] {
    const fileMap = new Map(existingFiles.map((file) => [this.fileKey(file), file]));
    for (const file of newFiles) {
      fileMap.set(this.fileKey(file), file);
    }

    return Array.from(fileMap.values());
  }

  private fileKey(file: File): string {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    return `${relativePath}|${file.name}|${file.size}|${file.lastModified}`;
  }

  private setCurrentStep(targetStep: number, action: string, explicitCurrentStep?: number): void {
    const currentStep = explicitCurrentStep ?? this.stepper?.selectedIndex ?? this.currentStep;
    const nextStep = Math.max(0, Math.min(3, targetStep));

    console.info('Create Project wizard navigation', {
      action,
      currentStep,
      targetStep: nextStep,
      wizardState: this.createLoggableWizardState(),
    });

    this.currentStep = nextStep;
    this.syncStepperIndex();
  }

  private syncStepperIndex(): void {
    queueMicrotask(() => {
      if (!this.stepper || this.stepper.selectedIndex === this.currentStep) {
        return;
      }

      this.stepper.selectedIndex = this.currentStep;
    });
  }

  private createLoggableWizardState(): Record<string, string | number | boolean> {
    return {
      projectName: this.projectName,
      descriptionLength: this.description.length,
      importMethod: this.importMethod,
      selectedFileCount: this.selectedFiles.length,
      selectedFolderFileCount: this.selectedFolderFiles.length,
      selectedFolderPath: this.selectedFolderPath,
      hasImportPreview: this.importPreview !== null,
    };
  }

  private hasUnsavedChanges(): boolean {
    return (
      this.currentStep > 0 ||
      this.projectName.trim().length > 0 ||
      this.description.trim().length > 0 ||
      this.selectedFiles.length > 0 ||
      this.selectedFolderFiles.length > 0 ||
      this.importPreview !== null
    );
  }

  private getSelectedFolderPath(files: File[]): string {
    const firstFile = files[0] as (File & { webkitRelativePath?: string }) | undefined;
    const relativePath = firstFile?.webkitRelativePath;
    if (!relativePath) {
      return files.length ? 'Selected folder' : '';
    }

    return relativePath.split('/')[0] ?? 'Selected folder';
  }

  private readErrorMessage(error: HttpErrorResponse): string {
    if (typeof error.error?.detail === 'string') {
      return error.error.detail;
    }

    return 'The selected files could not be validated.';
  }
}
