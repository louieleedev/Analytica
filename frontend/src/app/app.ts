import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ApplicationSettingsStore } from './core/application-settings-store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly applicationSettingsStore = inject(ApplicationSettingsStore);

  ngOnInit(): void {
    this.applicationSettingsStore.load();
  }
}
