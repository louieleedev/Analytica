import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { Project, ProjectSelection } from '../../core/project-selection';

@Component({
  selector: 'app-rename-project-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Rename Project</h2>
    <mat-dialog-content>
      <label class="fixed-field project-dialog-field">
        <span>Project Name</span>
        <mat-form-field appearance="outline">
          <input #projectName matInput [value]="project.name" placeholder="Enter project name" />
        </mat-form-field>
      </label>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="projectName.value.trim().length === 0"
        [mat-dialog-close]="projectName.value.trim()"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class RenameProjectDialog {
  protected readonly project = inject<Project>(MAT_DIALOG_DATA);
}

@Component({
  selector: 'app-delete-project-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Delete Project</h2>
    <mat-dialog-content>
      <p>Are you sure you want to delete this project?</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
})
export class DeleteProjectDialog {}

@Component({
  selector: 'app-projects',
  imports: [RouterLink, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './projects.html',
})
export class Projects {
  private readonly projectSelection = inject(ProjectSelection);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly projects = this.projectSelection.projects;

  protected openProject(project: Project): void {
    this.projectSelection.selectProject(project);
  }

  protected renameProject(event: MouseEvent, project: Project): void {
    event.preventDefault();
    event.stopPropagation();

    this.dialog
      .open(RenameProjectDialog, {
        data: project,
        width: '420px',
      })
      .afterClosed()
      .subscribe((projectName?: string) => {
        if (!projectName) {
          return;
        }

        this.projectSelection.renameProject(project.id, projectName);
      });
  }

  protected deleteProject(event: MouseEvent, project: Project): void {
    event.preventDefault();
    event.stopPropagation();

    this.dialog
      .open(DeleteProjectDialog, {
        width: '420px',
      })
      .afterClosed()
      .subscribe((confirmed?: boolean) => {
        if (!confirmed) {
          return;
        }

        const deletedActiveProject = this.projectSelection.activeProject()?.id === project.id;
        this.projectSelection.deleteProject(project.id);

        if (deletedActiveProject) {
          this.router.navigate(['/projects']);
        }
      });
  }
}
