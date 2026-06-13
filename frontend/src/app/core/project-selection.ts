import { Injectable, signal } from '@angular/core';

import {
  DatasetFileType,
  DetectedSchemaColumn,
  DatasetPreview,
  ImportedFileInfo,
  ImportMethod,
  ImportPreview,
} from './import-workflow.models';

export type ProjectStatus = 'Healthy' | 'Warning' | 'Error' | 'Draft';
export type ProjectState = 'Active' | 'Draft';

export type ProjectDatasetMetadata = {
  datasetId?: string;
  fileCount: number;
  rowCount: number;
  columnCount: number;
  datasetType: string;
  datasetSize?: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt?: string;
  rows: string;
  status: ProjectStatus;
  state: ProjectState;
  tone: 'ok' | 'warn' | 'error' | 'draft';
  datasetMetadata?: ProjectDatasetMetadata;
  schema?: DetectedSchemaColumn[];
  datasetPreview?: DatasetPreview;
  importedFiles?: ImportedFileInfo[];
  draft?: ProjectDraft;
};

export type ProjectDraft = {
  projectName: string;
  description: string;
  currentStep: number;
  importMethod: ImportMethod;
  selectedFileType: DatasetFileType;
  selectedFiles: File[];
  selectedFolderFiles: File[];
  selectedFolderPath: string;
  importPreview: ImportPreview | null;
};

@Injectable({ providedIn: 'root' })
export class ProjectSelection {
  private readonly projectsSignal = signal<Project[]>([
    {
      id: 'financial-review-workspace',
      name: 'Financial Review Workspace',
      description: 'Review imported financial exports for completeness and anomalies.',
      rows: '42.8M rows',
      status: 'Healthy',
      state: 'Active',
      tone: 'ok',
    },
    {
      id: 'vendor-analysis',
      name: 'Vendor Analysis',
      description: 'Analyze vendor-related structured exports.',
      rows: '9.4M rows',
      status: 'Warning',
      state: 'Active',
      tone: 'warn',
    },
    {
      id: 'audit-sampling-2026',
      name: 'Audit Sampling 2026',
      description: 'Prepare high-volume audit samples.',
      rows: '128M rows',
      status: 'Error',
      state: 'Active',
      tone: 'error',
    },
  ]);

  readonly projects = this.projectsSignal.asReadonly();
  readonly activeProject = signal<Project | null>(null);

  createProject(projectName: string, description: string, importPreview?: ImportPreview): Project {
    this.assertUniqueProjectName(projectName);

    const projectCount = this.projects().length;
    const rowCount = importPreview?.rowCount;
    const project: Project = {
      id: `${Date.now()}-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: projectName,
      description,
      createdAt: new Date().toISOString(),
      rows: rowCount === undefined ? `${((projectCount + 1) * 8.6).toFixed(1)}M rows` : `${rowCount.toLocaleString()} rows`,
      status: 'Healthy',
      state: 'Active',
      tone: 'ok',
      datasetMetadata: importPreview
        ? {
            datasetId: importPreview.datasetId,
            fileCount: importPreview.fileCount,
            rowCount: importPreview.rowCount,
            columnCount: importPreview.columnCount,
            datasetType: importPreview.datasetType,
            datasetSize: importPreview.datasetSize,
          }
        : undefined,
      schema: importPreview?.schema,
      datasetPreview: importPreview?.preview,
      importedFiles: importPreview?.files,
    };

    this.projectsSignal.update((projects) => [...projects, project]);
    return project;
  }

  saveDraft(draft: ProjectDraft, draftId?: string): Project {
    const projectName = draft.projectName.trim() || this.createUniqueDraftName();
    this.assertUniqueProjectName(projectName, draftId);

    const description = draft.description.trim() || 'Draft project creation in progress.';
    const project: Project = {
      id: draftId ?? `${Date.now()}-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-draft`,
      name: projectName,
      description,
      createdAt: new Date().toISOString(),
      rows: draft.importPreview ? `${draft.importPreview.rowCount.toLocaleString()} rows` : 'Draft',
      status: 'Draft',
      state: 'Draft',
      tone: 'draft',
      datasetMetadata: draft.importPreview
        ? {
            datasetId: draft.importPreview.datasetId,
            fileCount: draft.importPreview.fileCount,
            rowCount: draft.importPreview.rowCount,
            columnCount: draft.importPreview.columnCount,
            datasetType: draft.importPreview.datasetType,
            datasetSize: draft.importPreview.datasetSize,
          }
        : undefined,
      schema: draft.importPreview?.schema,
      datasetPreview: draft.importPreview?.preview,
      importedFiles: draft.importPreview?.files,
      draft: { ...draft },
    };

    this.projectsSignal.update((projects) => {
      const index = projects.findIndex((item) => item.id === project.id);
      if (index === -1) {
        return [...projects, project];
      }

      return projects.map((item) => (item.id === project.id ? project : item));
    });

    return project;
  }

  findProject(projectId: string): Project | undefined {
    return this.projects().find((project) => project.id === projectId);
  }

  activateDraft(projectId: string, projectName: string, description: string, importPreview: ImportPreview): Project {
    this.assertUniqueProjectName(projectName, projectId);

    const project: Project = {
      ...this.createProjectShape(projectId, projectName, description, importPreview),
    };

    this.projectsSignal.update((projects) =>
      projects.map((item) => (item.id === projectId ? project : item)),
    );
    return project;
  }

  selectProject(project: Project): void {
    this.activeProject.set(project);
  }

  renameProject(projectId: string, projectName: string): void {
    this.assertUniqueProjectName(projectName, projectId);

    this.projectsSignal.update((projects) =>
      projects.map((project) =>
        project.id === projectId ? { ...project, name: projectName } : project,
      ),
    );

    const activeProject = this.activeProject();
    if (activeProject?.id === projectId) {
      this.activeProject.set(this.projects().find((project) => project.id === projectId) ?? null);
    }
  }

  deleteProject(projectId: string): void {
    this.projectsSignal.update((projects) => projects.filter((project) => project.id !== projectId));

    if (this.activeProject()?.id === projectId) {
      this.activeProject.set(null);
    }
  }

  isProjectNameTaken(projectName: string, excludeProjectId?: string): boolean {
    const normalisedName = this.normaliseProjectName(projectName);
    if (!normalisedName) {
      return false;
    }

    return this.projects().some(
      (project) =>
        project.id !== excludeProjectId && this.normaliseProjectName(project.name) === normalisedName,
    );
  }

  private assertUniqueProjectName(projectName: string, excludeProjectId?: string): void {
    if (this.isProjectNameTaken(projectName, excludeProjectId)) {
      throw new Error('A project with this name already exists.');
    }
  }

  private createUniqueDraftName(): string {
    const baseName = 'Untitled Draft';
    if (!this.isProjectNameTaken(baseName)) {
      return baseName;
    }

    let suffix = 2;
    while (this.isProjectNameTaken(`${baseName} ${suffix}`)) {
      suffix += 1;
    }

    return `${baseName} ${suffix}`;
  }

  private normaliseProjectName(projectName: string): string {
    return projectName.trim().toLowerCase();
  }

  private createProjectShape(
    projectId: string,
    projectName: string,
    description: string,
    importPreview: ImportPreview,
  ): Project {
    return {
      id: projectId,
      name: projectName,
      description,
      createdAt: new Date().toISOString(),
      rows: `${importPreview.rowCount.toLocaleString()} rows`,
      status: 'Healthy',
      state: 'Active',
      tone: 'ok',
      datasetMetadata: {
        datasetId: importPreview.datasetId,
        fileCount: importPreview.fileCount,
        rowCount: importPreview.rowCount,
        columnCount: importPreview.columnCount,
        datasetType: importPreview.datasetType,
        datasetSize: importPreview.datasetSize,
      },
      schema: importPreview.schema,
      datasetPreview: importPreview.preview,
      importedFiles: importPreview.files,
    };
  }
}
