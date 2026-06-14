import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { HeaderComponent } from "./header.component";
import { SidebarComponent } from "./sidebar.component";

@Component({
  selector: "app-layout",
  imports: [RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <app-header></app-header>
    <div class="container-fluid mt-2">
      <div class="row g-2">
        <div class="col-12 col-md-2 d-none d-md-block">
          <app-sidebar></app-sidebar>
        </div>
        <div class="col-12 col-md-10">
          <router-outlet />
        </div>
      </div>
    </div>
    <footer class="text-center text-muted py-3 mt-4" style="font-size: 12px; border-top: 1px solid #ddd;">
      Wickets Exchange &middot; Play-money demo &middot; Educational project &middot;
      <span class="text-danger">No real wagering. Virtual chips only.</span>
    </footer>
  `,
})
export class LayoutComponent {}
