import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatStepperModule } from '@angular/material/stepper';

import { ProjectSelection } from '../../../core/project-selection';

@Component({
  selector: 'app-create-project',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    MatStepperModule,
  ],
  templateUrl: './create-project.html',
})
export class CreateProject {
  private readonly projectSelection = inject(ProjectSelection);
  private readonly router = inject(Router);

  protected importMethod: 'files' | 'folder' = 'files';

  protected readonly mockFiles = [
    { name: 'financial_export_q1.csv', size: '12.1 GB' },
    { name: 'financial_export_q2.csv', size: '11.7 GB' },
    { name: 'financial_export_q3.csv', size: '13.6 GB' },
  ];

  protected readonly selectedFolder = 'C:\\Data\\FinancialExports\\';

  protected get hasMockDataSelection(): boolean {
    if (this.importMethod === 'files') {
      return this.mockFiles.length > 0;
    }

    return this.selectedFolder.trim().length > 0;
  }

  protected isProjectInfoValid(projectName: string, description: string): boolean {
    return projectName.trim().length > 0 && description.trim().length > 0;
  }

  protected selectImportMethod(importMethod: 'files' | 'folder'): void {
    this.importMethod = importMethod;
  }

  protected createProject(projectName: string, description: string): void {
    if (!this.isProjectInfoValid(projectName, description) || !this.hasMockDataSelection) {
      return;
    }

    this.projectSelection.createProject(projectName.trim(), description.trim());
    this.router.navigate(['/projects']);
  }

  protected readonly schemaColumns = [
    { name: 'CompanyCode', type: 'Text' },
    { name: 'Country', type: 'Text' },
    { name: 'PostingDate', type: 'Date' },
    { name: 'AmountLocal', type: 'Decimal' },
    { name: 'Currency', type: 'Text' },
  ];
}
