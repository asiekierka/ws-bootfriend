; Copyright (c) 2023 Adrian Siekierka
;
; BootFriend is free software: you can redistribute it and/or modify it under
; the terms of the GNU General Public License as published by the Free
; Software Foundation, either version 3 of the License, or (at your option)
; any later version.
;
; BootFriend is distributed in the hope that it will be useful, but WITHOUT
; ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
; FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
; more details.
;
; You should have received a copy of the GNU General Public License along
; with BootFriend. If not, see <https://www.gnu.org/licenses/>. 

%include "hardware.inc"

; ERROR CODES:
; 11 [A] = XMODEM transfer - block transfer issue (ID != ~ID)
; 12 [B] = XMODEM transfer - block transfer issue (ID mismatch)
; 13 [C] = XMODEM transfer - cancelled
; 14 [D] = XMODEM transfer - invalid data (magic mismatch)
; 15 [E]
; 16 [F]
; 17 [G]
; 18 [H]
; 19 [I]
; 20 [J]
; 21 [K] = XMODEM transfer - block transfer issue (checksum)
; 22 [L]
; 23 [M]
; 24 [N]
; 25 [O]
; 26 [P]
; 27 [Q]
; 28 [R] = XMODEM transfer - out of range
; 29 [S]
; 30 [T]
; 31 [U]
; 32 [V]
; 33 [W]
; 34 [X]
; 35 [Y]
; 36 [Z]

bits 16
cpu 186
org 0x0000

	db 'b', 'F', 't' ; Padding
	db 'M' ; Console flags
	db 'p' ; Console name color
	db 0 ; Padding (must be 0)
	db 1 ; Size
	db 0x20 ; Start frame
	db 0x80 ; End frame
	db 0 ; Sprite count
	db 0x81 ; Palette flags
	db 64 ; Tile count
%ifdef ROM
	dw paletteData
	dw tilesetData
	dw tilemapData
%else
	dw ffffPointer
	dw ffffPointer
	dw ffffPointer
%endif
	dw 0x800 + (4 * 64) + (10 * 2) ; Horizontal tilemap offset
	dw 0x800 + (5 * 64) + (9 * 2) ; Vertical tilemap offset
	db 8 ; Tilemap width
	db 8 ; Tilemap height
	dw vblankHandler ; VBlank handler - segment
	dw 0x0600 ; VBlank handler - offset
	db 224/2 ; Console name X (horizontal)
	db 144/2 + 40 - 4 ; Console name Y (horizontal)
	db 144/2 - 4 ; Console name X (vertical)
	db 224 - (224/2 + 40) ; Console name Y (vertical)
bootFriendHeader:
	db 'b', 'F' ; Padding (BootFriend header)
	dw ffffPointer
soundChannelDataList:
	dw ffffPointer
	dw ffffPointer
	dw ffffPointer
ffffPointer:
	dw 0xFFFF

times 0x40-($-$$) db 0x00 ; Padding

%define BFB_HEADER_SIZE	4
%define xmBuffer     0xFF00 ; 128 bytes
%define xmExpectedId 0xFF9D ; 1 byte
%define ldStartAddr  0xFF9E ; 2 bytes
%define ldStartOffs  0xFFA0 ; 2 bytes (set to 0 by clear routine)
%define ldScrPos     0xFFA2 ; 2 bytes
%define xmLastDownloadFailed 0xFFA4 ; 1 byte
%define SOH 1
%define EOT 4
%define ACK 6
%define NAK 21
%define CAN 24

bootFriendVersion:
	db 0x03

vblankHandler:
	pusha
	pushf
	call bootfriend_check
	popf
	popa
	retf

bootfriend_hello:
	call bootfriend_takeover_init
	mov bl, 12 ; 'B'
	call loader_putc
	mov bl, 16 ; 'F'
	call loader_putc
	mov bl, cs:[bootFriendVersion]
	push bx
	shr bl, 4
	inc bx ; inc bl, but inc bx is safe here as we pop bx later
	call loader_putc
	pop bx
	and bl, 0x0F
	inc bx ; inc bl, but inc bx is safe here as it will only affect bl
	call loader_putc
	cs mov byte [vbl_noPCv2Strap + 1], 0x00 ; test always zero

bootfriend_loop:
	hlt
	call bootfriend_check
	jmp bootfriend_loop

bootfriend_check:
	push ds
	push es
	xor ax, ax
	mov ds, ax
	mov es, ax 

	mov al, 0x10
	out 0xB5, al
	daa
	in al, 0xB5

	; START OF KEY CHECKING CODE
	test al, 0x01 ; PCv2 bootstrap? (Y1)
	jz vbl_noPCv2Strap

	; Switch to Mono mode
	mov al, 0x0A
	out 0x60, al

	; Jump to PCv2 bootstrap
	jmp 0x4000:0x0010

vbl_noPCv2Strap:
	test al, 0x04 ; Hello mode? (Y3)
	jnz bootfriend_hello
	
	test al, 0x02 ; 9600 baud mode? (Y2)
	mov al, 0xA0
	jnz vbl_use9600Baud

	; 38400 baud mode
	mov al, 0xE0
vbl_use9600Baud:
	out IO_SERIAL_STATUS, al

	; END OF KEY CHECKING CODE

	; START OF INIT CODE - RUN ONLY ONCE
	clc
vbl_jumpToInitDone:
	jc vbl_initDone

	; We haven't been here before.

	; Configure serial RX handler
	cld
	in al, IO_HWINT_VECTOR
	and ax, 0x00F8
	shl ax, 2
	or al, (HWINT_IDX_SERIAL_RX << 2)
	mov di, ax
	mov ax, irq_serial
	stosw
	mov ax, cs
	stosw

	; Send NAK via serial port
	mov al, NAK
	call serial_putc_block

	; Enable serial RX handler
	in al, IO_HWINT_ENABLE
	or al, HWINT_SERIAL_RX
	out IO_HWINT_ENABLE, al

	cs mov byte [vbl_jumpToInitDone], 0xEB ; jump always

vbl_initDone:
	pop es
	pop ds
	ret

	; Serial receive IRQ handler, for bringup.
irq_serial:
	push ax

	; Is this the start of an XMODEM communication?
	in al, IO_SERIAL_DATA
	cmp al, SOH
	je loader_start

	; Acknowledge interrupt.
	mov al, HWINT_SERIAL_RX
	out IO_HWINT_ACK, al

	pop ax
	iret

bootfriend_takeover_init:
	cli
	cld

	; Set DS/ES.
	xor ax, ax
	mov ds, ax
	mov es, ax 

	; Clear memory - assumes AX = 0x0000
	mov di, 0xFFA0
	mov cx, 0x08
	rep stosw

	; Init display
	mov di, 0xFE00
	; xor ax, ax Accomplished above.
	out IO_SCR1_SCRL_X, ax ; Clear Screen 1 scroll
	stosw ; Set color 0:0 to black

	; Init display, part 2
	not ax
	stosw ; Set color 0:1 to white
	mov ax, 0x0001
	out IO_DISPLAY_CTRL, ax
	mov [xmExpectedId], al

	ret

; BARE-BONES XMODEM LOADER

	; We have ~500 cycles to spend here, ideally. Let's make them count.
loader_start:
	call bootfriend_takeover_init

	; Read first block.
	call loader_read_block
	mov [xmLastDownloadFailed], bl
	call loader_putc ; Output status character
	cmp bl, 42
	je loader_first_block_done
	call loader_full_read_block_resend_nak
loader_first_block_done:
	; Copy block to load area.
	mov si, xmBuffer
	lodsw ; Magic
	cmp ax, 0x4662 ; 'bF'
	mov bl, 14 ; 'D'
	jb loader_fail_end

	lodsw ; Address
	mov [ldStartAddr], ax
	cmp ax, 0xFFFF
	jne loader_non_relocatable
	inc ax ; == xor ax, ax here
	mov [ldStartAddr], ax
	mov ax, 0x0680
	mov [ldStartOffs], ax
	shl ax, 4

loader_non_relocatable:
	cmp ax, 0x6800
	mov bl, 28 ; 'R'
	jb loader_fail_end

	mov di, ax
	mov si, xmBuffer + BFB_HEADER_SIZE
	mov cx, ((128 - BFB_HEADER_SIZE) >> 1)
	rep movsw

	mov al, ACK
	call serial_putc_block

	; Read next blocks.
loader_next_block:
	cmp di, 0xFD80
	mov bl, 28 ; 'R'
	jae loader_fail_end
	push di

	call loader_full_read_block
	cmp bl, 0xFF
	je loader_blocks_done
	cmp bl, 42 ; This and v is probably refactorable.
	jne loader_fail_end

	; Copy block to load area.
	pop di
	mov si, xmBuffer
	mov cx, (128 >> 1)
	rep movsw

	call serial_putc_ack
	jmp loader_next_block

loader_blocks_done:
	mov bl, 42
	cmp bl, [xmLastDownloadFailed]
	jne loader_fail_end_loop

	call serial_putc_ack
	
	jmp far [ldStartAddr]

	; Read one XMODEM block into xmBuffer. Waits for SOH, repeats, etc.
	; Does not acknowledge.
	; Trashes AX, BX, CX, DI
	; Returns BL=255 on no more blocks, BL=42 otherwise
loader_full_read_block_resend_nak:
	mov al, NAK
	call serial_putc_block
loader_full_read_block:
	call serial_getc_block

	cmp al, CAN
	mov bl, 13 ; 'C'
	je loader_fail_end ; Cancelled - nothing we can do

	cmp al, EOT
	mov bl, 0xFF ; <nothing>
	je loader_full_read_block_end ; EOT - finish reading blocks

	cmp al, SOH
	jne loader_full_read_block_resend_nak ; !SOH - NAK?

	call loader_read_block ; SOH - read full block
	mov [xmLastDownloadFailed], bl
	call loader_putc ; Output status character
	cmp bl, 42
	jne loader_full_read_block_resend_nak ; Resend NAK if error
loader_full_read_block_end:
	ret

loader_fail_end:
	call loader_putc
loader_fail_end_loop:
	jmp loader_fail_end_loop

	; Read one XMODEM block into xmBuffer, after SOH.
	; trashes AX, CX, DI
	; returns BL = 42 on success, other on failure
loader_read_block:
	mov di, xmBuffer

	call serial_getc_block
	mov ah, al
	call serial_getc_block
	xor al, 0xFF
	; ID == ~ID?
	mov bl, 11 ; 'A'
	cmp ah, al
	jne loader_read_block_return
	; ID == expected ID?
	mov bl, 12 ; 'B'
	cmp al, [xmExpectedId]
	jne loader_read_block_return

loader_read_block_data:
	mov cx, 128
	mov di, xmBuffer
	xor ah, ah

loader_read_block_loop:
	call serial_getc_block
	add ah, al
	stosb
	loop loader_read_block_loop
	
	; Checksum + Check
	call serial_getc_block
	mov bl, 21 ; 'D'
	cmp ah, al
	jne loader_read_block_return

	mov bl, 42 ; '.'
	inc byte [xmExpectedId]
loader_read_block_return:
	ret

	; Read one byte from the serial port into AL.
serial_getc_block:
	in al, IO_SERIAL_STATUS
	test al, 0x01
	jz serial_getc_block
	in al, IO_SERIAL_DATA
	ret

	; Read one byte from the serial port into AL.
serial_putc_ack:
	mov al, ACK
serial_putc_block:
	push ax
serial_putc_block_loop:
	in al, IO_SERIAL_STATUS
	test al, 0x04
	jz serial_putc_block_loop
	pop ax
	out IO_SERIAL_DATA, al
	ret

	; Put one
	; BL = character
	; trashes AX, DI
loader_putc:
	push bx
	xor bh, bh
	mov ax, [ldScrPos]
	mov di, 0x0800
	add di, ax
	mov [di], bx
	add al, 2
	mov [ldScrPos], ax
	mov bx, ax
	and al, 0x3E
	cmp al, 56
	jb loader_putc_done
	mov ax, bx
	add ax, 8
	mov [ldScrPos], ax
	cmp ax, 576*2
	jb loader_putc_done
	xor ax, ax
	mov [ldScrPos], ax
loader_putc_done:
	pop bx
	ret

%ifdef ROM

paletteData:
	dw 0x0FFF
	dw 0x0AAA
	dw 0x0555
	dw 0x0000

tilesetData:
	times 512 dw 0

tilemapData:
	times 64 dw 0

times (2048 - 128)-($-$$) db 0x00 ; Padding

%else
%endif
