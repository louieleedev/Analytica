import { Component, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { ApplicationSettingsStore } from '../../core/application-settings-store';
import { ImportApi } from '../../core/import-api';
import { ApplicationSettings } from '../../core/import-workflow.models';

@Component({
  selector: 'app-settings',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
  private readonly importApi = inject(ImportApi);
  private readonly applicationSettingsStore = inject(ApplicationSettingsStore);

  protected settings: ApplicationSettings = {
    pivot_max_rows: 100,
    table_density: 'comfort',
  };
  protected isLoading = true;
  protected isSaving = false;
  protected statusMessage = '';
  protected errorMessage = '';

  protected get pivotMaxRowsError(): string {
    if (this.settings.pivot_max_rows < 10) {
      return 'Minimum value is 10.';
    }

    if (this.settings.pivot_max_rows > 300) {
      return 'Maximum value is 300.';
    }

    return '';
  }

  protected get canSaveSettings(): boolean {
    return !this.isSaving && !this.pivotMaxRowsError;
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  protected saveSettings(): void {
    if (!this.canSaveSettings) {
      return;
    }

    this.isSaving = true;
    this.statusMessage = '';
    this.errorMessage = '';

    this.importApi.updateSettings(this.settings).subscribe({
      next: (response) => {
        this.settings = response.settings;
        this.applicationSettingsStore.update(response.settings);
        this.isSaving = false;
        this.statusMessage = 'Settings saved.';
      },
      error: (error) => {
        this.isSaving = false;
        this.errorMessage = error?.error?.detail ?? 'Settings could not be saved.';
      },
    });
  }

  protected updatePivotMaxRows(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.settings = {
      ...this.settings,
      pivot_max_rows: Number.isFinite(value) ? value : this.settings.pivot_max_rows,
    };
  }

  protected updateTableDensity(event: Event): void {
    this.settings = {
      ...this.settings,
      table_density: (event.target as HTMLSelectElement).value,
    };
  }

  private loadSettings(): void {
    this.isLoading = true;
    this.statusMessage = '';
    this.errorMessage = '';

    this.importApi.getSettings().subscribe({
      next: (response) => {
        this.settings = response.settings;
        this.applicationSettingsStore.update(response.settings);
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = 'Settings could not be loaded.';
      },
    });
  }
}
