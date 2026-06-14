import { Routes } from "@angular/router";
import { LayoutComponent } from "./layout/layout.component";
import { HomeComponent } from "./pages/home.component";
import { MatchDetailComponent } from "./pages/match-detail.component";
import { BetHistoryComponent } from "./pages/bet-history.component";
import { ProfileComponent } from "./pages/profile.component";
import { AdminComponent } from "./pages/admin.component";
import { SearchComponent } from "./pages/search.component";

export const routes: Routes = [
  {
    path: "",
    component: LayoutComponent,
    children: [
      { path: "", redirectTo: "home", pathMatch: "full" },
      { path: "home", component: HomeComponent },
      { path: "match/:id", component: MatchDetailComponent },
      { path: "bet-history", component: BetHistoryComponent },
      { path: "myprofile", component: ProfileComponent },
      { path: "admin", component: AdminComponent },
      { path: "search", component: SearchComponent },
    ],
  },
  { path: "**", redirectTo: "home" },
];
