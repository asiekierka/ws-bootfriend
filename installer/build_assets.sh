#!/bin/sh
mkdir -p res
echo "[ Compiling 8x8 font ]"
python3 ../tools/font2raw.py ../res/font_default.png 8 8 a res/font_default.bin
python3 ../tools/bin2c.py res/font_default.c res/font_default.h res/font_default.bin
echo "[ Compiling BootFriend ]"
python3 ../tools/bin2c.py res/bootfriend.c res/bootfriend.h ../bootfriend.bin

