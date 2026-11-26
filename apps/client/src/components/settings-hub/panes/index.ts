import { AboutPane } from "./AboutPane";
import { AssetsPane } from "./AssetsPane";
import { DangerPane } from "./DangerPane";
import { DevicesPane } from "./DevicesPane";
import { FieldsPane } from "./FieldsPane";
import { ImagesPane } from "./ImagesPane";
import { LabelsPane } from "./LabelsPane";
import { MachinesPane } from "./MachinesPane";
import { MembersPane } from "./MembersPane";
import { PrioritiesPane } from "./PrioritiesPane";
import { RelationTypesPane } from "./RelationTypesPane";
import { StatusesPane } from "./StatusesPane";
import { StoragePane } from "./StoragePane";
import { UsersPane } from "./UsersPane";
import type { HubPane } from "./types";

/** Every pane the hub shows, one line each, alphabetical. */
export const HUB_PANES: readonly HubPane[] = [
  AboutPane,
  AssetsPane,
  DangerPane,
  DevicesPane,
  FieldsPane,
  ImagesPane,
  LabelsPane,
  MachinesPane,
  MembersPane,
  PrioritiesPane,
  RelationTypesPane,
  StatusesPane,
  StoragePane,
  UsersPane,
];
