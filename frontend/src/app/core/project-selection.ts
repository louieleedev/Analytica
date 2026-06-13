import { Injectable, signal } from '@angular/core';

export type ProjectStatus = 'Healthy' | 'Warning' | 'Error';

export type Project = {
  id: string;
  name: string;
  description: string;
  rows: string;
  status: ProjectStatus;
  tone: 'ok' | 'warn' | 'error';
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
      tone: 'ok',
    },
    {
      id: 'vendor-analysis',
      name: 'Vendor Analysis',
      description: 'Analyze vendor-related structured exports.',
      rows: '9.4M rows',
      status: 'Warning',
      tone: 'warn',
    },
    {
      id: 'audit-sampling-2026',
      name: 'Audit Sampling 2026',
      description: 'Prepare high-volume audit samples.',
      rows: '128M rows',
      status: 'Error',
      tone: 'error',
    },
  ]);

  readonly projects = this.projectsSignal.asReadonly();
  readonly activeProject = signal<Project | null>(null);

  createProject(projectName: string, description: string): Project {
    const projectCount = this.projects().length;
    const project: Project = {
      id: `${Date.now()}-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: projectName,
      description,
      rows: `${((projectCount + 1) * 8.6).toFixed(1)}M rows`,
      status: projectCount % 3 === 1 ? 'Warning' : 'Healthy',
      tone: projectCount % 3 === 1 ? 'warn' : 'ok',
    };

    this.projectsSignal.update((projects) => [...projects, project]);
    return project;
  }

  selectProject(project: Project): void {
    this.activeProject.set(project);
  }

  renameProject(projectId: string, projectName: string): void {
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
}
