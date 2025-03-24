// BootFriend for WS - Web configuration utility
// Copyright (c) 2023, 2024 Adrian "asie" Siekierka

function bf_reverse_bits(x) {
    x = ((x >> 1) & 0x55) | ((x & 0x55) << 1);
    x = ((x >> 2) & 0x33) | ((x & 0x33) << 2);
    x = (x >>> 4) | (x << 4);
    return x >>> 0;
}

// Tileset/tilemap conversion

const boot_tile_offset = 46;
var bfimg_inverse_color_correct = false;

function bfimg_color_to_ws(r, g, b) {
    if (bfimg_inverse_color_correct) {
        var r2 = (r *  124  - g *  20 - b *   4) / 100;
        var g2 = (r *   12  + g * 140 - b *  52) / 100;
        var b2 = (r * (-36) - g *  20 + b * 156) / 100;
        r = Math.max(0, Math.min(255, Math.floor(r2)));
        g = Math.max(0, Math.min(255, Math.floor(g2)));
        b = Math.max(0, Math.min(255, Math.floor(b2)));
    }
    return ((r & 0xF0) << 4) | (g & 0xF0) | (b >> 4);
}

function bfimg_wscolor_to_css(col) {
    var h = col.toString(16);
    while (h.length < 3) h = "0" + h;
    return "#" + h;
}

function bfimg_xy_to_idx(x, y) {
    return (x << 12) | y;
}

function bfimg_1bpp_to_n1_tile(t, bpp) {
    var u = [];
    for (var i = 0; i < t.length; i++) {
        u.push(t[i]);
        for (var j = 1; j < bpp; j++) {
           u.push(0);
        }
    }
    return u;
}

function bfimg_hflip_tile(t, bpp) {
    var u = [];
    for (var i = 0; i < t.length; i++) {
        u.push(bf_reverse_bits(t[i]));
    }
    return u;
}

function bfimg_vflip_tile(t, bpp) {
    var ih = t.length / bpp;
    var u = [];
    for (var i = 0; i < ih; i++) {
        for (var j = 0; j < bpp; j++) {
            u.push(t[(ih - 1 - i) * bpp + j]);
        }
    }
    return u;
}

function bfimg_to_tilemap(imageData, backgroundColor) {
    var data = imageData.data;
    backgroundColor = backgroundColor || 4095;
    
    if (imageData.width % 8 != 0 || imageData.height % 8 != 0) {
        window.alert("Image width/height is not a multiple of 8!");
        return null;
    }
    if (imageData.width > 2048 || imageData.height > 2048) {
        window.alert("Image width/height too large!");
        return null;
    }

    // generate palettes, calculate BPP, validate tile color count
    // this is not optimal... but it's good enough for now?
    var tooLargeTiles = [];
    var palettes = [];
    var palettePerTileIdx = {};
    for (var iy = 0; iy < imageData.height; iy += 8) {
        for (var ix = 0; ix < imageData.width; ix += 8) {
            var colors = {};
            for (var ty = 0; ty < 8; ty++) {
                for (var tx = 0; tx < 8; tx++) {
                    var i = ((iy+ty)*imageData.width+ix+tx)*4;
                    var col = bfimg_color_to_ws(data[i], data[i+1], data[i+2]);
                    colors[col] = true;
                }
            }
            var colorsLength = Object.keys(colors).length;
            if (colorsLength > 4) {
                tooLargeTiles.push(ix + ", " + iy);
            } else {
                var paletteFound = -1;
                for (var i = 0; i < palettes.length; i++) {
                    var foundKeysCount = 0;
                    var paletteKeysCount = 0;
                    for (var k of Object.keys(palettes[i])) {
                        paletteKeysCount++;
                        if (k in colors) {
                            foundKeysCount++;
                        }
                    }
                    if (foundKeysCount < colorsLength) {
                        var missingKeyCount = colorsLength - foundKeysCount;
                        if (missingKeyCount + paletteKeysCount <= (i < 7 ? 4 : 3)) {
                            for (var k of Object.keys(colors)) {
                                palettes[i][k] = true;
                            }
                            foundKeysCount = colorsLength;
                        }
                    }
                    if (foundKeysCount == colorsLength) {
                        paletteFound = i;
                        break;
                    }
                }
                if (paletteFound < 0) {
                    if (palettes.length > 7 && colors.length > 3) {
                        // TODO: Take a smaller palette from before and swap it in, if possible.
                        tooLargeTiles.push(ix + ", " + iy);
                    } else {
                        paletteFound = palettes.length;
                        palettes.push(colors);
                    }
                }
                palettePerTileIdx[bfimg_xy_to_idx(ix, iy)] = paletteFound;
            }
        }
    }
    if (tooLargeTiles.length > 0) {
        window.alert("Image has tiles with more than 4 colors in them: " + tooLargeTiles.join("; "));
        return null;
    }
    if (palettes.length > 11) {
        window.alert("Image has more than 11 palettes, which is not currently supported.");
        return null;
    }
    var paletteIndexSwap = [
        /**/1,  2,  3,
        8,  9,  10, 11,
        4,  5,  6,  7
    ];
    var paletteIndexSwapInv = {};
    for (var i = 0; i < paletteIndexSwap.length; i++) {
        paletteIndexSwapInv[paletteIndexSwap[i]] = i;
    }

    var maxColorsPerTile = 1;
    for (var i = 0; i < palettes.length; i++) {
        maxColorsPerTile = Math.max(Object.keys(palettes[i]).length, maxColorsPerTile);
    }
    var bpp = maxColorsPerTile > 2 ? 2 : 1;

    // convert palette to data
    console.log(palettes);
    var paletteIndices = [];
    var paletteData = [];

    paletteData.push(backgroundColor & 0xFF); paletteData.push(backgroundColor >> 8);
    for (var ix = 1; ix < (1 << bpp); ix++) { paletteData.push(0); paletteData.push(0); }

    var maxSwappedPaletteIndex = 0;
    for (var i = 0; i < palettes.length; i++) {
        maxSwappedPaletteIndex = Math.max(maxSwappedPaletteIndex, paletteIndexSwap[i]);
        paletteIndices.push(Object.keys(palettes[i]));
    }
    for (var i = 1; i <= maxSwappedPaletteIndex; i++) {
        var idxToRead = paletteIndexSwapInv[i];
        var p = paletteIndices[idxToRead] || [0,0,0,0];
        paletteIndices.push(p);
        for (var ix = 0; ix < (1 << bpp); ix++) {
            if (p.length <= ix) { paletteData.push(0); paletteData.push(0); }
            else { paletteData.push(p[ix] & 0xFF); paletteData.push(p[ix] >> 8); }
        }
    }

    // palettes in hand, let's build the tile data and tilemap
    // this is not optimal... but it's good enough for now?
    var tileIndex = 0;
    var tileData = [];
    var tileMap = [];
    var tileDataMap = new Map();

    // predefined tiles
    tileDataMap[bfimg_1bpp_to_n1_tile([0, 0, 0, 0, 0, 0, 0, 0], bpp)] = 0;

    for (var iy = 0; iy < imageData.height; iy += 8) {
        for (var ix = 0; ix < imageData.width; ix += 8) {
            var palidx = palettePerTileIdx[bfimg_xy_to_idx(ix, iy)];
            var indices = paletteIndices[palidx];
            var tile = new Array();

            for (var ty = 0; ty < 8; ty++) {
                var b0 = 0;
                var b1 = 0;
                for (var tx = 0; tx < 8; tx++) {
                    b0 <<= 1; b1 <<= 1;
                    var i = ((iy+ty)*imageData.width+ix+tx)*4;
                    // JAVASCRIPT
                    var col = "" + bfimg_color_to_ws(data[i], data[i+1], data[i+2]);
                    var idx = indices.indexOf(col);
                    if ((idx & 1) != 0) b0 |= 1;
                    if ((idx & 2) != 0) b1 |= 1;
                }
                tile.push(b0);
                if (bpp >= 2) tile.push(b1);
            }

            var tileMapEntry = ((paletteIndexSwap[palidx]) << 9);
            var tileMapIndex = -1;
        
            if (tile.join(",") in tileDataMap) {
                tileMapIndex = tileDataMap[tile.join(",")];
            } else {
                var htile = bfimg_hflip_tile(tile);
                if (htile.join(",") in tileDataMap) {
                    tileMapEntry |= 1 << 14;
                    tileMapIndex = tileDataMap[htile.join(",")];
                } else {
                    var vtile = bfimg_vflip_tile(tile);
                    if (vtile.join(",") in tileDataMap) {
                        tileMapEntry |= 2 << 14;
                        tileMapIndex = tileDataMap[vtile.join(",")];
                    } else {
                        var vhtile = bfimg_hflip_tile(vtile);
                        if (vhtile.join(",") in tileDataMap) {
                            tileMapEntry |= 3 << 14;
                            tileMapIndex = tileDataMap[vhtile.join(",")];
                        } else {
                            tileData.push(...tile);
                            tileDataMap[tile.join(",")] = tileIndex + boot_tile_offset;
                            tileMapIndex = tileIndex + boot_tile_offset;
                            tileIndex += 1;
                        }
                    }
                }
            }

            tileMapEntry |= tileMapIndex;
            tileMap.push(tileMapEntry & 0xFF);
            tileMap.push(tileMapEntry >> 8);
        }
    }
    
    console.log(tileData);
    console.log(tileMap);

    return {
        "bpp": bpp,
        "tiles": new Uint8Array(tileData),
        "map": new Uint8Array(tileMap),
        "palette": new Uint8Array(paletteData),
        "tileCount": tileIndex,
        "paletteCount": maxSwappedPaletteIndex + 1,
        "width": imageData.width >> 3,
        "height": imageData.height >> 3
    };
}

function bfimg_empty_tilemap() {
    return {
        "bpp": 1,
        "tiles": new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
        "map": new Uint8Array([0, 0]),
        "palette": new Uint8Array([0xFF, 0x0F, 0xFF, 0x0F]),
        "tileCount": 1,
        "paletteCount": 1,
        "width": 1,
        "height": 1
    };
}

function bfimg_tilemap_size(tm) {
    return tm.data.length + tm.map.length + tm.palette.length;
}

function bfimg_tilemap_to_imagedata(tm) {
    var imageData = new ImageData(tm.width * 8, tm.height * 8);
    var data = imageData.data;
    var bpp = tm.bpp;

    var tmi = 0;
    for (var iy = 0; iy < imageData.height; iy += 8) {
        for (var ix = 0; ix < imageData.width; ix += 8, tmi += 2) {
            var tm_entry = tm.map[tmi] | (tm.map[tmi + 1] << 8);
            var tm_tileidx = (tm_entry & 0x1FF);
            if (tm_tileidx == 0) continue;
            tm_tileidx -= boot_tile_offset;

            var tm_tileofs = tm_tileidx*(4 << bpp);
            var tm_pal = (tm_entry >> 9) & 0x0F;
            var tm_palofs = tm_pal*(2 << bpp);
            var tm_hflip = (tm_entry >> 14) & 0x01;
            var tm_vflip = (tm_entry >> 15) & 0x01;
            var tm_tile = [];
            for (var i = 0; i < 8*bpp; i++) {
                tm_tile.push(tm.tiles[tm_tileofs + i]);
            }
            if(tm_hflip) tm_tile = bfimg_hflip_tile(tm_tile);
            if(tm_vflip) tm_tile = bfimg_vflip_tile(tm_tile);

            for (var ty = 0; ty < 8; ty++) {
                var b0 = tm_tile[ty*bpp];
                var b1 = bpp >= 2 ? tm_tile[ty*bpp+1] : 0;
                for (var tx = 0; tx < 8; tx++, b0 <<= 1, b1 <<= 1) {
                    var bi = ((b0 & 128) >> 7) | ((b1 & 128) >> 6);
                    var ws_col = tm.palette[tm_palofs+bi*2] | (tm.palette[tm_palofs+bi*2+1] << 8);
                    var di = ((iy+ty)*imageData.width+ix+tx)*4;
                    data[di] = ((ws_col >> 8) & 0x0F) * 17;
                    data[di+1] = ((ws_col >> 4) & 0x0F) * 17;
                    data[di+2] = (ws_col & 0x0F) * 17;
                    data[di+3] = 255;
                }
            }
        }
    }

    return imageData;
}

// UI handling, installer generation

const bf_canvas = document.getElementById("bf-preview");
const bf_canvas_ctx = bf_canvas.getContext("2d");
const bf_font = document.getElementById("bf-font-default");
var bf_eeprom_type = 0;
var bf_custom_eeprom = null;
var bf_image = null;
var bf_colors = ["#000","#f00","#f70","#ff0","#7f0","#0f0","#0f7","#0ff","#07f","#00f","#70f","#f0f","#f07", "#fff"];
var bf_color = 0;
var bf_screen_mode = 0;

document.getElementById("input_custom_eeprom").onchange = function(e) {
    bf_custom_eeprom = null;
    var reader = new FileReader();
    reader.onload = function() {
        var eeprom = new Uint8Array(reader.result);
        if (eeprom.length == 2048) {
            bf_custom_eeprom = eeprom.subarray(128, 2048);
        } else if (eeprom.length <= 1920) {
            bf_custom_eeprom = eeprom;
        } else {
            window.alert("Invalid EEPROM size!");
            bf_custom_eeprom = null;
        }
    };
    reader.readAsArrayBuffer(e.target.files[0]);
}

document.getElementById("input_bf_image").onchange = function(e) {
    bf_image = null;
    bfui_generate_bootsplash_preview();
    var reader = new FileReader();
    reader.onload = function() {
        var img = new Image();
        img.src = reader.result;
        (function() {
            if (!img.complete) setTimeout(arguments.callee, 100)
            else {
                var ofc = new OffscreenCanvas(img.width, img.height);
                var ofc_ctx = ofc.getContext("2d");
                ofc_ctx.drawImage(img, 0, 0);

                var imageData = ofc_ctx.getImageData(0, 0, img.width, img.height);
                bf_image = bfimg_to_tilemap(imageData);
                console.log(bf_image);
                bfui_generate_bootsplash_preview();
            }
        })();
    };
    reader.readAsDataURL(e.target.files[0]);
}

Coloris.setInstance("#input_bf_background_color", {
    format: 'hex',
    alpha: false
});

function bfui_select_color(col) {
    bf_color = col;
    var sel = document.getElementById("bf_color_selection");
    sel.innerHTML = "";
    for (var i = 0; i < bf_colors.length; i++) {
        var el = document.createElement("div");
        el.style.display = "inline-block";
        el.style.marginTop = "6px";
        el.style.border = "2px solid " + (i == col ? "#000" : "#fff");
        el.style.backgroundColor = bf_colors[i];
        el.style.width = "9px";
        el.style.height = "9px";
        el.style.cursor = "pointer";
        let ii = i;
        el.addEventListener("click", function() {
            bfui_select_color(ii);
        })
        sel.appendChild(el);
    }
    bfui_generate_bootsplash_preview();
}

function bfui_set_orientation_vertical(vertical) {
	if (vertical) {
        document.getElementById("input_preview_orientation_h").classList.remove("pure-button-active");
        document.getElementById("input_preview_orientation_v").classList.add("pure-button-active");
    } else {
        document.getElementById("input_preview_orientation_h").classList.add("pure-button-active");
        document.getElementById("input_preview_orientation_v").classList.remove("pure-button-active");
    }
    bfui_generate_bootsplash_preview();
}

function bfui_set_eeprom_type(idx) {
    bf_eeprom_type = idx;
    for (var i = 0; i <= 1; i++) {
        if(idx != i) {
            document.getElementById("input_eeprom_type_" + i).classList.remove("pure-button-active");
            document.getElementById("eeprom_type_" + i).classList.add("tab-hidden");
            if(i == 0) document.getElementById("pane_preview").classList.add("tab-hidden");
        } else {
            document.getElementById("input_eeprom_type_" + i).classList.add("pure-button-active");
            document.getElementById("eeprom_type_" + i).classList.remove("tab-hidden");
            if(i == 0) document.getElementById("pane_preview").classList.remove("tab-hidden");
        }
    }
    bfui_generate_bootsplash_preview();
}

function bfui_set_screen_mode(idx) {
    bf_screen_mode = idx;
    for (var i = 0; i <= 1; i++) {
        if(idx != i) document.getElementById("input_preview_mode_" + i).classList.remove("pure-button-active");
        else document.getElementById("input_preview_mode_" + i).classList.add("pure-button-active");
    }
    bfui_generate_bootsplash_preview();
}

function bfui_change_inverse_color_correction() {
    bfimg_inverse_color_correct = document.getElementById("input_image_inverse_color_correction").checked;
    bfui_generate_bootsplash_preview();
}

function bf_get_background_color() {
    var s = document.getElementById("input_bf_background_color").value;
    var c = parseInt(s.substring(1), 16);
    return ((c >> 12) & 0xF00) | ((c >> 8) & 0xF0) | ((c >> 4) & 0x0F);
}

function bf_get_name_locations() {
    var name_h_enabled = document.getElementById("input_name_h").checked;
    var name_hx = parseInt(document.getElementById("input_name_hx").value);
    var name_hy = parseInt(document.getElementById("input_name_hy").value);
    var name_v_enabled = document.getElementById("input_name_v").checked;
    var name_vx = parseInt(document.getElementById("input_name_vx").value);
    var name_vy = parseInt(document.getElementById("input_name_vy").value);
    if (!name_h_enabled) { name_hx = 112; name_hy = 160; }
    if (!name_v_enabled) { name_vx = 72; name_vy = -16; }
    return [[name_hx, name_hy], [name_vx, name_vy]];
}

function bf_get_image_locations() {
    if (bf_image == null) return [[31, 31], [31, 31]];
    var image_hx, image_hy, image_vx, image_vy;
    var image_al = parseInt(document.getElementById("input_image_alignment").value);
    if      ((image_al % 3) == 0) { image_hx = 0; image_vx = 0; }
    else if ((image_al % 3) == 1) { image_hx = (28 - bf_image.width) >> 1; image_vx = (18 - bf_image.width) >> 1; }
    else if ((image_al % 3) == 2) { image_hx = 28 - bf_image.width; image_vx = 18 - bf_image.width; }
    if      (Math.floor(image_al / 3) == 0) { image_hy = 0; image_vy = 0; }
    else if (Math.floor(image_al / 3) == 1) { image_hy = (18 - bf_image.height) >> 1; image_vy = (28 - bf_image.height) >> 1; }
    else if (Math.floor(image_al / 3) == 2) { image_hy = 18 - bf_image.height; image_vy = 28 - bf_image.height; }
    image_hx += parseInt(document.getElementById("input_image_offset_hx").value);
    image_hy += parseInt(document.getElementById("input_image_offset_hy").value);
    image_vx += parseInt(document.getElementById("input_image_offset_vx").value);
    image_vy += parseInt(document.getElementById("input_image_offset_vy").value);
    image_hx = Math.max(0, Math.min(28 - bf_image.width, image_hx));
    image_hy = Math.max(0, Math.min(18 - bf_image.width, image_hy));
    image_vx = Math.max(0, Math.min(18 - bf_image.height, image_vx));
    image_vy = Math.max(0, Math.min(28 - bf_image.height, image_vy));

    return [[image_hx, image_hy], [image_vx, image_vy]];
}

function bf_draw_char_at(x, y, c, color) {
    var ofc1 = new OffscreenCanvas(8, 8);
    var ofc1_ctx = ofc1.getContext("2d");;
    var cx = (c & 31) * 8;
    var cy = (c >> 5) * 8;

    ofc1_ctx.globalCompositeOperation = "copy"; 
    ofc1_ctx.drawImage(bf_font, cx, cy, 8, 8, 0, 0, 8, 8);
    ofc1_ctx.fillStyle = color;
    ofc1_ctx.globalCompositeOperation = "multiply"; 
    ofc1_ctx.fillRect(0, 0, 8, 8);
    ofc1_ctx.globalCompositeOperation = "destination-atop"; 
    ofc1_ctx.drawImage(bf_font, cx, cy, 8, 8, 0, 0, 8, 8);
    bf_canvas_ctx.drawImage(ofc1, x, y);
    bf_canvas_ctx.drawImage(ofc1, x-256, y);
    bf_canvas_ctx.drawImage(ofc1, x, y-256);
    bf_canvas_ctx.drawImage(ofc1, x-256, y-256);
}

function bfui_generate_bootsplash_preview() {
    var consoleName = "WONDERSWANCOLOR";
	var vertical = document.getElementById("input_preview_orientation_v").classList.contains("pure-button-active");
    var nameLocs = bf_get_name_locations()[vertical ? 1 : 0];
    var imageLocs = bf_get_image_locations()[vertical ? 1 : 0];

    bf_canvas.width = vertical ? 144 : 224;
    bf_canvas.height = !vertical ? 144 : 224;

    var c = bf_get_background_color();
    bf_canvas_ctx.fillStyle = bfimg_wscolor_to_css(c);
    bf_canvas_ctx.fillRect(0, 0, bf_canvas.width, bf_canvas.height);

    // draw image
    if (bf_image != null) {
        var dt = bfimg_tilemap_to_imagedata(bf_image);
        bf_canvas_ctx.putImageData(dt, imageLocs[0] * 8, imageLocs[1] * 8);
    }

    // draw name
    // - center -> top-left
    nameLocs[0] -= 4 * consoleName.length;
    nameLocs[1] -= 4;
    // - draw
    for (var i = 0; i < consoleName.length; i++) {
        var c = consoleName.charCodeAt(i);
        var cx = (nameLocs[0] + (i * 8)) & 0xFF;
        var cy = (nameLocs[1]) & 0xFF;
        bf_draw_char_at(cx, cy, c, bf_colors[bf_color]);
    }

    if (bf_screen_mode != 1) {
        var imageData = bf_canvas_ctx.getImageData(0, 0, bf_canvas.width, bf_canvas.height);
        var highContrast = false;
        for (var i = 0; i < imageData.data.length; i += 4) {
            var r = imageData.data[i] >> 4;
            var g = imageData.data[i + 1] >> 4;
            var b = imageData.data[i + 2] >> 4;

            // apply color emulation - algorithm by Near
            if (highContrast) {
                r = Math.floor(Math.min(15, r * 1.5));
                g = Math.floor(Math.min(15, g * 1.5));
                b = Math.floor(Math.min(15, b * 1.5));
            }

            var r2 = (r * 26 + g *  4 + b *  2);
            var g2 = (         g * 24 + b *  8);
            var b2 = (r *  6 + g *  4 + b * 22);

            imageData.data[i] = r2 >> 1;
            imageData.data[i + 1] = g2 >> 1;
            imageData.data[i + 2] = b2 >> 1;
        }
        bf_canvas_ctx.putImageData(imageData, 0, 0);
    }
}
	
function bf_pad_string(s, len) {
	var side = false;
	while (s.length < len) {
		if (side) s = s + " "; else s = " " + s;
		side = !side;
	}
	return s;
}

function bf_pad_zeros(s, len) {
	s = "" + s;
	while (s.length < len) s = "0" + s;
	return s;
}

function bf_generate_bootsplash() {
    var splashData = new Uint8Array(1920);
    splashData.set(bin_bootfriend_template);
    var idx = bin_bootfriend_template.length;

    var endTimeSeconds = parseFloat(document.getElementById("input_duration").value);
    var nameLocs = bf_get_name_locations();
    var imageLocs = bf_get_image_locations();
    var bgColor = bf_get_background_color();

    splashData[0x04] = bf_color;
    splashData[0x08] = Math.max(0x80, Math.min(0xF0, Math.round(endTimeSeconds * 75.47)));
    splashData[0x1C] = (nameLocs[0][1] - 4) & 0xFF;
    splashData[0x1D] = (nameLocs[0][0] - 4) & 0xFF;
    splashData[0x1E] = (nameLocs[1][0] - 4) & 0xFF;
    splashData[0x1F] = (224 - nameLocs[1][1] - 4) & 0xFF;

    var tm = bf_image;
    if (tm == null) tm = bfimg_empty_tilemap();
    splashData[0x0A] = (tm.bpp == 2 ? 0x80 : 0x00) | tm.paletteCount;
    if (tm.tileCount > 192) {
        window.alert("Too many unique tiles in image.");
        return null;
    }
    if (tm.width <= 0 || tm.width > 32 || tm.height <= 0 || tm.height > 32) {
        window.alert("Invalid image width/height.");
        return null;
    }
    splashData[0x0B] = tm.tileCount;
    splashData[0x16] = tm.width;
    splashData[0x17] = tm.height;

    splashData[0x0C] = idx & 0xFF;
    splashData[0x0D] = idx >> 8;
    if(idx + tm.palette.length <= splashData.length) {
        splashData.set(tm.palette, idx);
        splashData[idx] = bgColor & 0xFF;
        splashData[idx + 1] = bgColor >> 8;
    }
    idx += tm.palette.length;

    splashData[0x0E] = idx & 0xFF;
    splashData[0x0F] = idx >> 8;
    if(idx + tm.tiles.length <= splashData.length) splashData.set(tm.tiles, idx);
    idx += tm.tiles.length;

    splashData[0x10] = idx & 0xFF;
    splashData[0x11] = idx >> 8;
    if(idx + tm.map.length <= splashData.length) splashData.set(tm.map, idx);
    idx += tm.map.length;

    var screenDestH = 2 * (imageLocs[0][0] + (imageLocs[0][1] * 32)) + 0x800;
    var screenDestV = 2 * ((27 - imageLocs[1][1]) + (imageLocs[1][0] * 32)) + 0x800;
    splashData[0x12] = screenDestH & 0xFF;
    splashData[0x13] = screenDestH >> 8;
    splashData[0x14] = screenDestV & 0xFF;
    splashData[0x15] = screenDestV >> 8;

    if (idx > 1920) {
        window.alert("Splash data too large (" + idx + " > 1920).");
        return null;
    }

    if (idx <= 0x380) {
        splashData[0x06] = 0;
    }

	return splashData;
}

function bf_generate_title(verHi, verLo) {
    var verStr = String.fromCharCode(verHi, verLo);

	var date = new Date();
	var dateString = bf_pad_zeros(date.getFullYear() % 100, 2)
		+ bf_pad_zeros(date.getMonth() + 1, 2)
		+ bf_pad_zeros(date.getDate(), 2)
		+ bf_pad_zeros(date.getHours(), 2)
		+ bf_pad_zeros(date.getMinutes(), 2);
	if (bf_eeprom_type == 0) return "bootfriend-inst" + verStr + " " + dateString;
    else return "ieepsplash-inst" + verStr + " " + dateString;
}

function bf_typedArray_indexOf(haystack, needle) {
	var haystackStr = new TextDecoder("ascii").decode(haystack);
	return haystackStr.indexOf(needle);
}

function bf_generate_splashdata() {
    if (bf_eeprom_type == 0) {
        return bf_generate_bootsplash();
    } else {
        if (bf_custom_eeprom == null) {
            window.alert("No custom EEPROM provided!");
            return null;
        }
        return bf_custom_eeprom;
    }
}

function bf_generate_eeprom() {
    var eeprom = new Uint8Array(2048);
    var splashdata = bf_generate_splashdata();
    if (splashdata == null) return null;

    eeprom.set(splashdata, 128);

    // "BOOTFRIEND"
    eeprom[0x60] = 0x0C;
    eeprom[0x61] = 0x19;
    eeprom[0x62] = 0x19;
    eeprom[0x63] = 0x1E;
    eeprom[0x64] = 0x10;
    eeprom[0x65] = 0x1C;
    eeprom[0x66] = 0x13;
    eeprom[0x67] = 0x0F;
    eeprom[0x68] = 0x18;
    eeprom[0x69] = 0x0E;
    eeprom[0x6A] = 0x00;
    eeprom[0x6B] = 0x25;

    // Color console configuration
    eeprom[0x80] = 0;
    eeprom[0x81] = 0;
    eeprom[0x82] = 0;
    eeprom[0x83] = 0x83;

    // SwanCrystal factory TFT data at 0xAE
    eeprom[0xAE] = 0xD0;
    eeprom[0xAF] = 0x77;
    eeprom[0xB0] = 0xF7;
    eeprom[0xB1] = 0x06;
    eeprom[0xB2] = 0xE2;
    eeprom[0xB3] = 0x0A;
    eeprom[0xB4] = 0xEA;
    eeprom[0xB5] = 0xEE;

    return eeprom;
}

function bf_generate_rom(bin, bin_size) {
    if (bin_size < 0) bin_size = bin.length;

	var rom_index = bf_typedArray_indexOf(bin, "bFtMp");
	var title_index = bf_typedArray_indexOf(bin, "bootfriend-inst devel. bui");

    var splashdata = bf_generate_splashdata();
    if (splashdata == null) return null;

	var rom = new Uint8Array(bin_size);
	rom.set(bin);
    rom.set(splashdata, rom_index);
	rom.set(Uint8Array.from(bf_pad_string(bf_generate_title(rom[title_index + 26], rom[title_index + 27]), 28), c => c.charCodeAt(0)), title_index);

	return rom;
}

function bf_wwcode(data, decode) {
	var output = new Uint8Array(data.length);
	var prevB = 0xFF;
	for (var i = 0; i < data.length; i++) {
		if ((i & 0x7F) == 0) {
			prevB = 0xFF;
		}
		if (decode) {
			output[i] = data[i] ^ prevB;
			prevB = data[i];
		} else {
			var b = data[i] ^ prevB;
			prevB = b;
			output[i] = b;
		}
	}
	return output;
}

function bf_generate_image(type) {
	if (type == "rom") {
		return bf_generate_rom(bin_bootfriend_inst_rom, 131072);
	} else if (type == "wwfx") {
		return bf_generate_rom(bin_bootfriend_inst_fx, -1);
	} else if (type == "wwsoft") {
		return bf_wwcode(bf_generate_rom(bin_bootfriend_inst_rom, 131072).subarray(0, 64168), false);
	} else if (type == "raw") {
		return bf_generate_splashdata();
	} else if (type == "eeprom") {
		return bf_generate_eeprom();
	}
}

function bf_download(filename, data) {
    if (data == null) return;
	if (!document.getElementById("bf-warranty-check").checked) {
		window.alert("You must agree to the warranty disclaimer before continuing.");
		return;
	}

    var blob = new Blob([data], {type: "application/octet-stream"});
    var url = document.createElement('a');
	var href = window.URL.createObjectURL(blob);
    url.href = href;
	url.style = "display: none;";
	url.download = filename;
	document.body.appendChild(url);
	url.click();
	url.remove();
	setTimeout(function() { return window.URL.revokeObjectURL(href); }, 30000);
}

function bf_decode_base64(s) {
	return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

setTimeout(function() {
    bfui_generate_bootsplash_preview();
}, 480);

bfui_select_color(0);
