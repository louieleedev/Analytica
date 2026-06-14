import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

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

type PersistedProject = {
  id: string;
  name: string;
  description: string;
  createdAt?: string;
  updatedAt?: string;
  status: ProjectStatus;
  state: ProjectState;
  datasetMetadata?: ProjectDatasetMetadata | null;
};

@Injectable({ providedIn: 'root' })
export class ProjectSelection {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = 'http://127.0.0.1:8000';
  private readonly activeProjectStorageKey = 'analytica.activeProjectId';
  private readonly projectsSignal = signal<Project[]>([]);

  readonly projects = this.projectsSignal.asReadonly();
  readonly activeProject = signal<Project | null>(null);

  constructor() {
    this.loadProjects();
  }

  loadProjects(): void {
    this.http
      .get<PersistedProject[]>(`${this.apiBaseUrl}/projects`)
      .pipe(map((projects) => projects.map((project) => this.mapPersistedProject(project))))
      .subscribe({
        next: (projects) => {
          this.projectsSignal.set(projects);
          this.restoreActiveProject(projects);
        },
      });
  }

  createProject(projectName: string, description: string, importPreview?: ImportPreview): Observable<Project> {
    this.assertUniqueProjectName(projectName);

    return this.http
      .post<PersistedProject>(`${this.apiBaseUrl}/projects`, {
        name: projectName,
        description,
        datasetId: importPreview?.datasetId ?? null,
      })
      .pipe(
        map((project) => this.mapPersistedProject(project, importPreview)),
        tap((project) => {
          this.projectsSignal.update((projects) => [project, ...projects]);
        }),
      );
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

  activateDraft(
    projectId: string,
    projectName: string,
    description: string,
    importPreview: ImportPreview,
  ): Observable<Project> {
    this.assertUniqueProjectName(projectName, projectId);

    return this.http
      .post<PersistedProject>(`${this.apiBaseUrl}/projects`, {
        name: projectName,
        description,
        datasetId: importPreview.datasetId,
      })
      .pipe(
        map((project) => this.mapPersistedProject(project, importPreview)),
        tap((project) => {
          this.projectsSignal.update((projects) =>
            projects.map((item) => (item.id === projectId ? project : item)),
          );
        }),
      );
  }

  selectProject(project: Project): void {
    this.activeProject.set(project);
    localStorage.setItem(this.activeProjectStorageKey, project.id);
  }

  renameProject(projectId: string, projectName: string): Observable<Project> {
    this.assertUniqueProjectName(projectName, projectId);

    return this.http
      .patch<PersistedProject>(`${this.apiBaseUrl}/projects/${projectId}`, { name: projectName })
      .pipe(
        map((project) => this.mapPersistedProject(project)),
        tap((updatedProject) => {
          this.projectsSignal.update((projects) =>
            projects.map((project) => (project.id === projectId ? updatedProject : project)),
          );

          if (this.activeProject()?.id === projectId) {
            this.activeProject.set(updatedProject);
          }
        }),
      );
  }

  deleteProject(projectId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiBaseUrl}/projects/${projectId}`).pipe(
      tap(() => {
        this.removeProjectFromState(projectId);
      }),
    );
  }

  deleteLocalProject(projectId: string): void {
    this.removeProjectFromState(projectId);
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

  private mapPersistedProject(project: PersistedProject, importPreview?: ImportPreview): Project {
    const datasetMetadata = project.datasetMetadata ?? undefined;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      rows: datasetMetadata ? `${datasetMetadata.rowCount.toLocaleString()} rows` : 'No dataset',
      status: project.status,
      state: project.state,
      tone: this.projectTone(project.status, project.state),
      datasetMetadata,
      schema: importPreview?.schema,
      datasetPreview: importPreview?.preview,
      importedFiles: importPreview?.files,
    };
  }

  private projectTone(status: ProjectStatus, state: ProjectState): Project['tone'] {
    if (state === 'Draft') {
      return 'draft';
    }

    if (status === 'Warning') {
      return 'warn';
    }

    if (status === 'Error') {
      return 'error';
    }

    return 'ok';
  }

  private restoreActiveProject(projects: Project[]): void {
    const activeProjectId = localStorage.getItem(this.activeProjectStorageKey);
    if (!activeProjectId) {
      return;
    }

    const activeProject = projects.find((project) => project.id === activeProjectId);
    if (activeProject) {
      this.activeProject.set(activeProject);
      return;
    }

    localStorage.removeItem(this.activeProjectStorageKey);
    this.activeProject.set(null);
  }

  private removeProjectFromState(projectId: string): void {
    this.projectsSignal.update((projects) => projects.filter((project) => project.id !== projectId));

    if (this.activeProject()?.id === projectId) {
      this.activeProject.set(null);
      localStorage.removeItem(this.activeProjectStorageKey);
    }
  }
}
