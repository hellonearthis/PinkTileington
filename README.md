# PinkTileington

PinkTileington is a browser-based, interactive tool designed for extracting tiles and creating sprite atlases from **oblique projection (3/4 top-down)** game art. Unlike traditional grid slicing tools that expect rectangular grids, PinkTileington uses **affine transformations** to overlay a parallelogram grid onto your source art. This makes it effortless to extract perfectly aligned tiles even when the original art has sheared or angled perspectives.

## TL;DR — Quick Start

1. **Download:** Clone this repository or download it as a ZIP file.
2. **Setup:** You do **not** need to run `npm init` or install packages. All dependencies (like p5.js and JSZip) are pulled securely via CDNs.
3. **Run Server:** Because the tool needs to read local files and use canvas extraction, it must run on a local web server (opening the HTML file directly will cause browser security errors). 

   **The Easy Way (Windows):**
   Simply double-click the `start.bat` file in the folder! It will automatically start the server and open the app in your default browser. Leave the black terminal window open while you work.

   **The Manual Way:**
   *Using Node.js:*
   ```bash
   npx http-server -p 8080 -c-1 -o
   ```
   *Using Python:*
   ```bash
   python -m http.server 8080
   ```

> **Can this run on GitHub Pages?** 
> **Yes!** PinkTileington is a 100% static application with zero backend requirements. You can push this exact folder to a GitHub repository, enable GitHub Pages, and it will work perfectly right out of the box.

## Features

- **Affine Grid Transformations:** Configure shear angles (X and Y) to match your game's oblique projection.
- **Visual Extraction:** Drop an image in, define the grid, and extract tiles using exact clipping paths that maintain correct transparency and angled edges.
- **Collision Metadata:** Define walkability, collision type (wall, water, hazard, custom), and visually track which tiles have collision data.
- **Export to JSON & ZIP:** Export your atlas as a single JSON file (with Base64 encoded PNGs) or as a ZIP archive containing individual PNG files and an `atlas.json` manifest.
- **Native GameMaker Export:** Directly generate ready-to-use `.yy` sprite files with automatically configured `xorigin/yorigin` anchors and bounding box footprints based on the grid projection.
- **Import JSON Atlases:** You can reload a previously exported JSON atlas to append more tiles to it, or edit the collision data of your existing set.
- **Zero-Dependency Setup:** Runs entirely in the browser using HTML5 Canvas (p5.js) and JSZip. No build tools or Node.js server needed to run locally!

## GameMaker Studio Integration

PinkTileington provides a native export feature that generates GameMaker 2026 LTS compatible `.yy` sprite structures, completely eliminating manual configuration.

1. **Exporting the Project:**
   - In PinkTileington, navigate to the **Export** tab and click **"Export GameMaker Project"**.
   - This downloads a ZIP archive containing a structured `sprites/` directory.

2. **Importing into GameMaker:**
   - Extract the downloaded ZIP archive.
   - Simply drag and drop the extracted `sprites/` folder directly into your GameMaker project directory, or import them via the IDE.
   - Every tile will automatically appear as an individual Sprite resource.

3. **Pre-configured Data:**
   - **Origins:** The `xorigin` and `yorigin` of each sprite are automatically calculated and placed at the exact center of the tile's floor footprint, ensuring flawless `depth = -y` sorting out of the box.
   - **Collision Masks:** The bounding boxes (`bbox_left`, `bbox_right`, etc.) are mapped to the floor contact area of the oblique projection, ignoring the empty transparent spaces around roofs or tree branches.

If you prefer to define custom polygon-based floor collision objects programmatically, the ZIP archive also includes an `_atlas_data.json` file containing the raw mathematical coordinate polygons.

## How to Use

1. **Load Art:** Drop a `.png`, `.jpg`, or `.webp` file into the canvas, or click **"Open Image"**.
2. **Setup the Grid:** In the **Grid** tab on the sidebar, adjust the Cell Dimensions (Width and Height) and the **Shear Angles**. The overlay grid will dynamically skew to match your art's isometric/oblique depth lines.
3. **Select & Extract:** Click on grid cells to select them (`Ctrl` + Click to multi-select, `Shift` + Click for a range). Then go to the **Tiles** tab and click **Extract Selected Tiles**.
4. **Edit Collision:** Click on an extracted tile in the Gallery. In the **Collision** tab, set whether the tile is walkable or assign it a collision type.
5. **Export:** Go to the **Export** tab and download your work as a JSON Atlas, a ZIP Archive, or a native GameMaker Project.
6. **Import (Resume Work):** Click **"Import JSON"** in the header to load a previously exported JSON Atlas. This restores the grid configuration and loads the saved tiles and their collision metadata back into the editor so you can add more to it!

## Technical Data

- **Frameworks Used:** 
  - [p5.js](https://p5js.org/) for canvas rendering, zooming, panning, and rendering the grid overlay.
  - [JSZip](https://stuk.github.io/jszip/) for bundling the PNG files into an archive.
- **Styling:** Vanilla CSS3 utilizing a custom "dark-mode glassmorphism" design system, CSS Variables for theming, and CSS Grid/Flexbox for the layout.
- **Grid Mathematics:** Linear transformations (affine math) in `js/grid.js` implement inverse kinematics to perform hit-tests (clicking on an angled grid cell resolves to an exact row and column coordinate).
- **Extraction:** Tile extraction uses off-screen Canvas rendering combined with `CanvasRenderingContext2D.clip()` applying a specific `Path2D` parallelogram quad, maintaining full alpha channel transparency for angled shapes.

## License
MIT License
