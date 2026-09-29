import { register } from "../../shared/hub";
import { ChecklistOverlay } from "./ChecklistOverlay";
import { ChecklistTool } from "./ChecklistTool";
import "./styles.css";

register("checklist", { Tool: ChecklistTool, Overlay: ChecklistOverlay });
