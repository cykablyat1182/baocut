import 'package:flutter/material.dart';

abstract final class AppColors {
  static const canvas = Color(0xFF050607);
  static const overlay = Color(0xE80B0D0F);
  static const overlaySoft = Color(0xC70B0D0F);
  static const overlayHover = Color(0xFF232426);
  static const selected = Color(0xFF2D2A23);
  static const amber = Color(0xFFF2B84B);
  static const amberMuted = Color(0xFFBA8B37);
  static const ivory = Color(0xFFF5F1EA);
  static const text = Color(0xFFE8E8E8);
  static const textMuted = Color(0xFFA7AAAE);
  static const divider = Color(0x24FFFFFF);
  static const focus = Color(0xFFF8CD75);
  static const success = Color(0xFF6DDA9B);
  static const danger = Color(0xFFFF6B6B);
}

abstract final class AppTheme {
  static const uiFont = 'Inter';
  static const subtitleFont = 'Lora';
  static const fontFallback = ['NotoSansSC'];

  static ThemeData dark() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.amber,
      brightness: Brightness.dark,
      surface: AppColors.overlay,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme.copyWith(
        primary: AppColors.amber,
        onPrimary: AppColors.canvas,
        surface: AppColors.overlay,
        onSurface: AppColors.text,
        error: AppColors.danger,
      ),
      scaffoldBackgroundColor: AppColors.canvas,
      canvasColor: AppColors.canvas,
      fontFamily: uiFont,
      fontFamilyFallback: fontFallback,
      textTheme: Typography.material2021().white.apply(
        bodyColor: AppColors.text,
        displayColor: AppColors.ivory,
        fontFamily: uiFont,
        fontFamilyFallback: fontFallback,
      ),
      dividerColor: AppColors.divider,
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: const Color(0xF21B1D20),
          border: Border.all(color: AppColors.divider),
          borderRadius: BorderRadius.circular(7),
        ),
        textStyle: const TextStyle(
          color: AppColors.ivory,
          fontSize: 12,
          height: 1.2,
        ),
        waitDuration: const Duration(milliseconds: 450),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: const Color(0xFF141618),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.divider),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: const Color(0xFF1A1C1E),
        contentTextStyle: const TextStyle(color: AppColors.ivory),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      focusColor: AppColors.focus.withValues(alpha: 0.22),
      splashFactory: InkSparkle.splashFactory,
    );
  }
}
