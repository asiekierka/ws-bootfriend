/**
 * Copyright (c) 2022, 2023 Adrian Siekierka
 *
 * BootFriend is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * BootFriend is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with BootFriend. If not, see <https://www.gnu.org/licenses/>. 
 */

#include <stdbool.h>
#include <stdio.h>
#include <wonderful.h>
#include <ws.h>
#ifdef __WONDERFUL_WWITCH__
#include <sys/bios.h>
#endif

#include "bootfriend.h"
#include "boot_splash.h"
#include "font_default.h"
#include "input.h"
#include "ui.h"
#include "util.h"
#include "xmodem.h"

#ifndef __WONDERFUL_WWITCH__
__attribute__((section(".iramx_1800")))
uint8_t reserved_space[0x4000 - 0x1800];

volatile uint16_t vbl_ticks;
extern void vblank_int_handler(void);
#endif

// Must be 24 chars
//                                      1234567890123456789012345678
static const char IN_ROM bfi_title[] = "bootfriend-inst devel. bui07";
static const char IN_ROM bfi_eeprom_locked[] = "EEP locked";
static const char IN_ROM bfi_eeprom_unlocked[] = "EEP unlocked";
static const char IN_ROM bfi_no_splash[] = "no splash";
static const char IN_ROM bfi_invalid_splash[] = "invalid splash";
static const char IN_ROM bfi_no_bf[] = "non-BF splash";
static const char IN_ROM bfi_bf_found[] = "BF v.%02X";

ws_boot_splash_header_t boot_header_data;
static bool boot_header_update_required;
static bool boot_header_splash_valid;

bool is_ww_mode(void) {
	uint8_t __far* freya_bios_header = (uint8_t __far*) MK_FP(0xF000, 0x0000);
	if (freya_bios_header[0] == 'E'
		&& freya_bios_header[1] == 'L'
		&& freya_bios_header[2] == 'I'
		&& freya_bios_header[3] == 'S'
		&& freya_bios_header[4] == 'A') {
		return true;
	}
	return false;
}

void boot_header_mark_changed(void) {
	boot_header_update_required = true;
}

void boot_header_refresh(void) {
	if (!boot_header_update_required) return;
	ws_eeprom_read_data(ws_eeprom_handle_internal(), 0x80, (uint8_t*) &boot_header_data, sizeof(ws_boot_splash_header_t));
	boot_header_splash_valid = ws_boot_splash_is_header_valid(&boot_header_data);
	boot_header_update_required = false;
}

static void statusbar_update(void) {
	boot_header_refresh();
	char buf[29];

	for (uint8_t i = 0; i < 28; i++) {
		SCREEN1[i] = SCR_ENTRY_PALETTE(COLOR_TITLE) | bfi_title[i];
	}
	ui_clear_lines(1, 1);

	const char __far *eeprom_status = ws_ieep_protect_check() ? bfi_eeprom_locked : bfi_eeprom_unlocked;
	ui_puts(0, 1, COLOR_BLACK, eeprom_status);

	// detect BootFriend
	bool splash_active = boot_header_data.options1 & IEEP_C_OPTIONS1_CUSTOM_SPLASH;
	bool splash_bf = boot_header_data.pad5 == 'b' && boot_header_data.pad6 == 'F';
	bool splash_valid = boot_header_splash_valid;
	if (!splash_valid && !splash_active) {
		strcpy(buf, bfi_no_splash);
	} else if (!splash_valid && splash_active) {
		strcpy(buf, bfi_invalid_splash);
	} else if (splash_valid && !splash_bf) {
		strcpy(buf, bfi_no_bf);
	} else if (splash_valid && splash_bf) {
		uint8_t bf_version = boot_header_data.bootfriend_version;
		if (bf_version == 0x60) bf_version = 0x00;
		snprintf(buf, sizeof(buf), bfi_bf_found, bf_version);
	} else {
		buf[0] = '?'; buf[1] = 0;
	}
	ui_puts(28 - strlen(buf), 1, splash_active ? COLOR_BLACK : COLOR_GRAY, buf);
}

static void toggle_boot_splash(void) {
	uint16_t word_0x82 = ws_eeprom_read_word(ws_eeprom_handle_internal(), 0x82);
	word_0x82 ^= (IEEP_C_OPTIONS1_CUSTOM_SPLASH << 8);
	ws_eeprom_write_word(ws_eeprom_handle_internal(), 0x82, word_0x82);

	boot_header_mark_changed();
	statusbar_update();
}

#ifndef __WONDERFUL_WWITCH__
extern const char __far ws_ieep_internal_owner_to_ascii_map[];
#ifdef __IA16_CMODEL_IS_FAR_TEXT
extern void bootfriend_vblank_handler(void) __attribute__((interrupt));
#else
extern void bootfriend_vblank_handler(void);
#endif

static void test_bootfriend(void) {
	// copy BootFriend to IRAM
	memcpy((uint8_t*) 0x6000, _bootfriend_bin, _bootfriend_bin_size);

	uint8_t vbl_bootstrap[12];
	vbl_bootstrap[0] = 0x50; // PUSH AX
	vbl_bootstrap[1] = 0x9A; // CALL far
	vbl_bootstrap[2] = _bootfriend_bin[0x18];
	vbl_bootstrap[3] = _bootfriend_bin[0x19];
	vbl_bootstrap[4] = _bootfriend_bin[0x1A];
	vbl_bootstrap[5] = _bootfriend_bin[0x1B];
	vbl_bootstrap[6] = 0xB0; // MOV AL,
	vbl_bootstrap[7] = 0xFF; // [ack value]
	vbl_bootstrap[8] = 0xE6; // OUT IO_HWINT_ACK, AL
	vbl_bootstrap[9] = 0xB6;
	vbl_bootstrap[10] = 0x58; // OP AX
	vbl_bootstrap[11] = 0xCF; // IRET

	// prepare UI
    outportb(IO_SCR_BASE, SCR1_BASE(0x0800));
	for (uint8_t i = 0; i <= 42; i++) {
		const uint8_t __far *src = _font_default_bin + (ws_ieep_internal_owner_to_ascii_map[i] * 8);
		uint16_t *dst = (uint16_t*) (0x2000 + (i * 16));
		for (int i = 0; i < _font_default_bin_size; i++) {
			*(dst++) = *(src++);
		}
	}

	cpu_irq_disable();
	ws_hwint_set_handler(HWINT_IDX_VBLANK, vbl_bootstrap);
	ws_hwint_enable(HWINT_VBLANK);
	cpu_irq_enable();

	while (true) {
		cpu_halt();
		cpu_irq_disable();
		uint16_t keys = ws_keypad_scan();
		cpu_irq_enable();
		if (keys & KEY_B) break;
	}

	cpu_irq_disable();
	ws_hwint_set_handler(HWINT_IDX_VBLANK, vblank_int_handler);
	ws_hwint_enable(HWINT_VBLANK);
	cpu_irq_enable();

	// restore UI
	ui_init();
	statusbar_update();
}
#endif

static const char IN_ROM msg_are_you_sure_install[] = "THIS SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND.\n\nWould you like to install?";
static const char IN_ROM msg_installing_eeprom_data[] = "Installing IEEPROM data...";
static const char IN_ROM msg_verifying_eeprom_data[] =  "Verifying IEEPROM data....";
static const char IN_ROM msg_backing_up_eeprom[] = "Backing up IEEPROM...";
static const char IN_ROM msg_verify_error[] =  "Verify error @ %03X";
static const char IN_ROM msg_do_not_turn_off[] = "Do not turn off the console!";
static const char IN_ROM msg_none[] = "";

static void install_bootfriend(const uint8_t __far* data, uint16_t data_size) {
	ws_eeprom_handle_t ieep_handle = ws_eeprom_handle_internal();

	ui_puts(1, 3, COLOR_BLACK, msg_installing_eeprom_data);
	ui_puts(0, 5, COLOR_RED, msg_do_not_turn_off);

	cpu_irq_disable();

	// Disable the custom splash, if enabled.
	uint16_t word_0x82 = ws_eeprom_read_word(ieep_handle, 0x82);
	if (word_0x82 & (IEEP_C_OPTIONS1_CUSTOM_SPLASH << 8)) {
		word_0x82 ^= (IEEP_C_OPTIONS1_CUSTOM_SPLASH << 8);
		ws_eeprom_write_word(ieep_handle, 0x82, word_0x82);
	}

	// Write BootFriend data; skip sensitive/user-configurable areas
	uint16_t steps_per_progress = (data_size - 4) / (26 * 2);
	uint8_t step_counter = 0;
	uint16_t step_counter_min = 0;

	for (uint16_t i = 0x04; i < data_size; i += 2) {
		// skip invalid colors
		if (i == 4 && data[i] >= 0x10) continue;

		// skip SwanCrystal data block
		if (!(i >= 0x2C && i < 0x36)) {
			uint16_t w = *((const uint16_t __far*) (data + i));
			uint16_t w2 = ws_eeprom_read_word(ieep_handle, i + 0x80);
			if (w != w2) {
				ws_eeprom_write_word(ieep_handle, i + 0x80, w);
			}
		}

		if (step_counter < 26 && (++step_counter_min) == steps_per_progress) {
			SCREEN1[1 + (step_counter++) + (15 << 5)] = SCR_ENTRY_PALETTE(COLOR_SELECTED);
			step_counter_min = 0;
		}
	}

	// Verify read.
	ui_puts(1, 3, COLOR_BLACK, msg_verifying_eeprom_data);
	ui_clear_lines(15, 15);

	step_counter = 0;
	step_counter_min = 0;

	for (uint16_t i = 0x04; i < data_size; i += 2) {
		// skip invalid colors
		if (i == 4 && data[i] >= 0x10) continue;

		// skip SwanCrystal data block
		if (!(i >= 0x2C && i < 0x36)) {
			uint16_t w = *((const uint16_t __far*) (data + i));
			uint16_t w2 = ws_eeprom_read_word(ieep_handle, i + 0x80);
			if (w != w2) {
				ui_clear_lines(15, 15);

				ui_printf(1, 15, COLOR_RED, msg_verify_error, i);
				cpu_irq_enable();
				wait_for_keypress();

				goto EndInstall;
			}
		}

		if (step_counter < 26 && (++step_counter_min) == steps_per_progress) {
			SCREEN1[1 + (step_counter++) + (15 << 5)] = SCR_ENTRY_PALETTE(COLOR_SELECTED);
			step_counter_min = 0;
		}
	}

	// Enable the custom splash.
	word_0x82 |= (IEEP_C_OPTIONS1_CUSTOM_SPLASH << 8);
	ws_eeprom_write_word(ieep_handle, 0x82, word_0x82);
	

EndInstall:
	cpu_irq_enable();
	ui_clear_lines(3, 16);

	boot_header_mark_changed();
	statusbar_update();
}

static const char IN_ROM msg_are_you_sure_recovery[] = "THIS SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND.\n\nThis option tries to restore factory TFT configuration for SwanCrystal consoles.\n\nWould you like to continue?";
static const uint8_t IN_ROM swancrystal_factory_tft_data[] = {
	0xD0, 0x77, 0xF7, 0x06, 0xE2, 0x0A, 0xEA, 0xEE
};

static void recovery_swancrystal(void) {
	ws_eeprom_handle_t ieep_handle = ws_eeprom_handle_internal();

	for (uint8_t i = 0; i < 8; i += 2) {
		uint16_t w = *((uint16_t __far*) (swancrystal_factory_tft_data + i));
		uint16_t w2 = ws_eeprom_read_word(ieep_handle, 0xAE + i);
		if (w != w2) {
			ws_eeprom_write_word(ieep_handle, 0xAE + i, w);
		}
	}

	boot_header_mark_changed();
	statusbar_update();
}

static const char IN_ROM msg_are_you_sure[] = "Are you sure?";
static const char IN_ROM msg_yes[] = "Yes";
static const char IN_ROM msg_no[] = "No";

bool menu_confirm(const char __far *text, uint8_t text_height, bool centered, bool yes_default) {
	menu_entry_t entries[2];
	uint8_t height = text_height + 3;
	uint8_t y_text = 3 + ((14 - height) >> 1);
	uint8_t y_menu = y_text + text_height + 1;

	ui_puts(centered ? (28 - strlen(text)) >> 1 : 0, y_text, 0, text);

	entries[0].text = yes_default ? msg_yes : msg_no;  entries[0].flags = 0;
	entries[1].text = yes_default ? msg_no : msg_yes; entries[1].flags = 0;
	uint8_t result = ui_menu_run(entries, 2, y_menu);

	ui_clear_lines(y_text, y_text + text_height - 1);
	return yes_default ? (result == 0) : (result == 1);
}

static const char IN_ROM msg_test_bootfriend[] = "Test BootFriend";
static const char IN_ROM msg_install_bootfriend[] = "Install BootFriend";
static const char IN_ROM msg_install_splash[] = "Install splash";
static const char IN_ROM msg_disable_splash[] = "Disable custom splash";
static const char IN_ROM msg_enable_splash[] = "Enable custom splash";
static const char IN_ROM msg_disable_bf[] = "Disable BootFriend";
static const char IN_ROM msg_enable_bf[] = "Enable BootFriend";
static const char IN_ROM msg_recover_swancrystal[] = "SwanCrystal TFT recovery";
static const char IN_ROM msg_restore_xmodem_backup[] = "Restore IEEPROM (XMODEM)";
static const char IN_ROM msg_backup_xmodem[] = "Backup IEEPROM (XMODEM)";
#ifdef __WONDERFUL_WWITCH__
static const char IN_ROM msg_exit[] = "Exit";
#else
static const char IN_ROM msg_restore_sram_backup[] = "Restore IEEPROM (SRAM)";
#endif

uint8_t menu_show_main(void) {
	boot_header_refresh();
	bool splash_active = boot_header_data.options1 & IEEP_C_OPTIONS1_CUSTOM_SPLASH;
	bool splash_bf = boot_header_data.pad5 == 'b' && boot_header_data.pad6 == 'F';

	ws_boot_splash_header_t __far* provided_header = (ws_boot_splash_header_t __far*) _bootfriend_bin;
	bool provided_splash_bf = provided_header->pad5 == 'b' && provided_header->pad6 == 'F';

	ws_boot_splash_header_t __far* sram_header = (ws_boot_splash_header_t __far*) MK_FP(0x1000, 0x0080);
	bool sram_splash_valid = ws_boot_splash_is_header_valid(sram_header);

	menu_entry_t entries[8];
	uint8_t entry_count = 0;

	entries[entry_count].text = msg_test_bootfriend;
#ifdef __WONDERFUL_WWITCH__
	entries[entry_count++].flags = MENU_ENTRY_DISABLED;
#else
	entries[entry_count++].flags = provided_splash_bf ? 0 : MENU_ENTRY_DISABLED;
#endif
	entries[entry_count].text = provided_splash_bf ? msg_install_bootfriend : msg_install_splash;
	entries[entry_count++].flags = ws_ieep_protect_check() ? MENU_ENTRY_DISABLED : 0;
	entries[entry_count].text = splash_active ? (splash_bf ? msg_disable_bf : msg_disable_splash) : (splash_bf ? msg_enable_bf : msg_enable_splash);
	entries[entry_count++].flags = (ws_ieep_protect_check() || (!splash_active && !boot_header_splash_valid)) ? MENU_ENTRY_DISABLED : 0;
	entries[entry_count].text = msg_recover_swancrystal;
	entries[entry_count++].flags = ws_ieep_protect_check() ? MENU_ENTRY_DISABLED : 0;
	entries[entry_count].text = msg_none;
	entries[entry_count++].flags = MENU_ENTRY_DISABLED;
	entries[entry_count].text = msg_backup_xmodem;
	entries[entry_count++].flags = 0;
	entries[entry_count].text = msg_restore_xmodem_backup;
	entries[entry_count++].flags = 0;
#ifdef __WONDERFUL_WWITCH__
	entries[entry_count].text = msg_exit;
	entries[entry_count++].flags = 0;
#else
	entries[entry_count].text = msg_restore_sram_backup;
	entries[entry_count++].flags = sram_splash_valid ? 0 : MENU_ENTRY_DISABLED;
#endif

	uint8_t result = ui_menu_run(entries, entry_count, 3 + ((14 - entry_count) >> 1));
        ui_puts(0, 0, COLOR_RED, msg_none); // TODO: compiler error workaround
	return result;
}

static const char IN_ROM msg_backup_check[] = "Would you like to backup your internal EEPROM to cartridge save RAM first?";
static const char IN_ROM msg_xmodem_backup_check[] = "Would you like to backup your internal EEPROM via XMODEM transfer first?";
void xmodem_backup(void);

void do_backup_check(void) {
#ifndef __WONDERFUL_WWITCH__
	ws_eeprom_handle_t ieep_handle = ws_eeprom_handle_internal();
	ws_boot_splash_header_t __far* provided_header = (ws_boot_splash_header_t __far*) MK_FP(0x1000, 0x0080);

	input_wait_clear();

	if (is_ww_mode()) {
		if (menu_confirm(msg_xmodem_backup_check, 5, false, true)) xmodem_backup();
	} else {
		if (!ws_boot_splash_is_header_valid(provided_header) && menu_confirm(msg_backup_check, 5, false, true)) {
			ui_clear_lines(3, 17);
			ui_puts(1, 3, COLOR_BLACK, msg_backing_up_eeprom);
			uint16_t __far *sram_ptr = (uint16_t __far*) MK_FP(0x1000, 0x0000);
			for (uint16_t i = 0; i < 2048; i += 2) {
				*(sram_ptr++) = ws_eeprom_read_word(ieep_handle, i);
			}
			ui_clear_lines(3, 3);
		}
	}
#endif
}

static const char IN_ROM msg_xmodem_init[] = "Initializing XMODEM transfer";
static const char IN_ROM msg_xmodem_progress[] = "Transferring data";
static const char IN_ROM msg_erase_progress[] = "Erasing data";
static const char IN_ROM msg_xmodem_transfer_error[] = "Transfer error";
static const char IN_ROM msg_restore_invalid_size[] = "Invalid file size";
static const char IN_ROM msg_restore_invalid_contents[] = "Invalid file contents";

static void xmodem_status(const char __far *str) {
        ui_clear_lines(6, 6);
        ui_puts_centered(6, COLOR_BLACK, str);
}

void xmodem_backup(void) {
	ws_eeprom_handle_t ieep_handle = ws_eeprom_handle_internal();
	uint8_t xm_buffer[2048];

	ui_clear_lines(3, 17);
	for (uint16_t ip = 0; ip < 2048; ip += 2) {
		*((uint16_t __far*) (xm_buffer + ip)) = ws_eeprom_read_word(ieep_handle, ip);
	}
	xmodem_status(msg_xmodem_init);
	xmodem_open(SERIAL_BAUD_38400);

        if (xmodem_send_start() == XMODEM_OK) {
#ifndef __WONDERFUL_WWITCH__
                cpu_irq_disable();
#endif
                xmodem_status(msg_xmodem_progress);
                for (uint16_t ib = 0; ib < 16; ib++) {
                        uint8_t result = xmodem_send_block(xm_buffer + (ib << 7));
                        switch (result) {
                        case XMODEM_OK:
                               break;
                        case XMODEM_ERROR:
                               xmodem_status(msg_xmodem_transfer_error);
#ifndef __WONDERFUL_WWITCH__
                               ws_hwint_ack(0xFF);
                               cpu_irq_enable();
#endif
				wait_for_keypress();
                        case XMODEM_SELF_CANCEL:
                        case XMODEM_CANCEL:
                               goto End;
                        }
                }
                xmodem_send_finish();
        }
End:
#ifndef __WONDERFUL_WWITCH__
        ws_hwint_ack(0xFF);
        cpu_irq_enable();
#endif
        xmodem_close();
        ui_clear_lines(3, 17);
}

void xmodem_restore(void) {
	uint8_t xm_buffer[2048];
	uint16_t xm_position = 0;

	ui_clear_lines(3, 17);
	xmodem_open(SERIAL_BAUD_38400);

#ifndef __WONDERFUL_WWITCH__
        cpu_irq_disable();
#endif
        xmodem_status(msg_xmodem_progress);
        {
                xmodem_recv_start();
                for (uint16_t ib = 0; ib < 16; ib++) {
                        uint8_t result = xmodem_recv_block(xm_buffer + xm_position);
			xm_position += 128;
                        xmodem_recv_ack();
                        switch (result) {
                        case XMODEM_OK:
                               break;
			case XMODEM_COMPLETE:
				goto End;
                        case XMODEM_ERROR:
                               xm_position = 0;
                               xmodem_status(msg_xmodem_transfer_error);
#ifndef __WONDERFUL_WWITCH__
                               ws_hwint_ack(0xFF);
                               cpu_irq_enable();
#endif
				wait_for_keypress();
				ui_clear_lines(3, 17);
				return;
                        case XMODEM_SELF_CANCEL:
                        case XMODEM_CANCEL:
#ifndef __WONDERFUL_WWITCH__
                               ws_hwint_ack(0xFF);
                               cpu_irq_enable();
#endif
				ui_clear_lines(3, 17);
				return;
                        }
                }
        }

End:
#ifndef __WONDERFUL_WWITCH__
        ws_hwint_ack(0xFF);
        cpu_irq_enable();
#endif
        xmodem_close();
        ui_clear_lines(3, 17);

        // verify and install
	uint8_t __far* data_ptr = xm_buffer;
	uint16_t data_size = 1920;
	if (xm_position == 2048) {
		data_ptr += 0x80;
	} else if (xm_position > 1920) {
		xmodem_status(msg_restore_invalid_size);
		wait_for_keypress();
		return;
	} else {
		data_size = xm_position;
	}

	if (!ws_boot_splash_is_header_valid(data_ptr)) {
		xmodem_status(msg_restore_invalid_contents);
		wait_for_keypress();
		return;
	}

	install_bootfriend(data_ptr, data_size);
}

void menu_main(void) {
	input_wait_clear();
	switch (menu_show_main()) {
#ifndef __WONDERFUL_WWITCH__
	case 0: // Test BootFriend
		test_bootfriend();
		break;
#endif
	case 1: // Install BootFriend
		if (menu_confirm(msg_are_you_sure_install, 6, false, false)) {
			do_backup_check();
			install_bootfriend(_bootfriend_bin, _bootfriend_bin_size);
		}
		break;
	case 2: // Disable/Enable boot splash
		if (menu_confirm(msg_are_you_sure, 1, true, false)) toggle_boot_splash();
		break;
	case 3: // SwanCrystal recovery
		if (menu_confirm(msg_are_you_sure_recovery, 9, false, false)) recovery_swancrystal();
		break;
	case 5: // XMODEM backup
		xmodem_backup();
		break;
	case 6: // XMODEM backup
		if (menu_confirm(msg_are_you_sure, 1, true, false)) {
			xmodem_restore();
		}
		break;
#ifdef __WONDERFUL_WWITCH__
	case 7: // Exit
		bios_exit();
		break;
#else
	case 7: // SRAM restore
		if (menu_confirm(msg_are_you_sure, 1, true, false)) {
			install_bootfriend(MK_FP(0x1000, 0x0080), 2048 - 0x80);
		}
		break;
#endif
	}
}

int main(void) {
#ifndef __WONDERFUL_WWITCH__
	cpu_irq_disable();
#endif

	boot_header_mark_changed();
	ui_init();
	statusbar_update();

#ifndef __WONDERFUL_WWITCH__
	outportb(IO_HWINT_ACK, 0xFF);
	ws_hwint_set_handler(HWINT_IDX_VBLANK, vblank_int_handler);
	ws_hwint_enable(HWINT_VBLANK);
	cpu_irq_enable();
#endif

	while(1) {
		menu_main();
	}
}
