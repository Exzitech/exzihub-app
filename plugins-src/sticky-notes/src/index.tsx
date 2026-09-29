import { register } from "../../shared/hub";
import { NotesOverlay } from "./NotesOverlay";
import { NotesTool } from "./NotesTool";
import "./styles.css";

register("sticky-notes", { Tool: NotesTool, Overlay: NotesOverlay });
