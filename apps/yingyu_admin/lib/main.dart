import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import 'admin_api.dart';
import 'admin_models.dart';

const _background = Color(0xFF0D1117);
const _surface = Color(0xFF141A22);
const _border = Color(0xFF283341);
const _text = Color(0xFFE9EEF5);
const _muted = Color(0xFF8E9BAB);
const _accent = Color(0xFF67D3C1);
const _warning = Color(0xFFF3B760);
const _danger = Color(0xFFF07575);

String _formatTokens(int value) {
  if (value >= 1000000000) {
    return '${(value / 1000000000).toStringAsFixed(1)}B';
  }
  if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
  if (value >= 1000) return '${(value / 1000).toStringAsFixed(1)}K';
  return '$value';
}

String _formatPaidAmounts(List<PaidAmount> amounts) {
  if (amounts.isEmpty) return '—';
  return amounts
      .map((amount) {
        final value = (amount.amountMinor / 100).toStringAsFixed(2);
        return switch (amount.currency.toLowerCase()) {
          'cny' => '¥$value',
          'usd' => '\$$value',
          'eur' => '€$value',
          _ => '${amount.currency.toUpperCase()} $value',
        };
      })
      .join(' · ');
}

String _formatMicros(int micros, String currency) {
  final amount = micros / 1000000;
  final decimals = amount.abs() > 0 && amount.abs() < 0.01 ? 4 : 2;
  final value = amount.toStringAsFixed(decimals);
  return switch (currency.toLowerCase()) {
    'cny' => '¥$value',
    'usd' => '\$$value',
    'eur' => '€$value',
    _ => '${currency.toUpperCase()} $value',
  };
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const YingYuAdminApp());
}

class YingYuAdminApp extends StatefulWidget {
  const YingYuAdminApp({super.key, this.api, this.persistEndpoint = true});

  final AdminApi? api;
  final bool persistEndpoint;

  @override
  State<YingYuAdminApp> createState() => _YingYuAdminAppState();
}

class _YingYuAdminAppState extends State<YingYuAdminApp> {
  late final AdminApi _api;
  AdminSession? _session;
  String _endpoint = 'http://127.0.0.1:8787';

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminApi();
    unawaited(_loadEndpoint());
  }

  Future<void> _loadEndpoint() async {
    if (!widget.persistEndpoint) return;
    final file = _endpointFile();
    if (file == null) return;
    try {
      final saved = (await file.readAsString()).trim();
      if (saved.isNotEmpty && mounted) setState(() => _endpoint = saved);
    } on FileSystemException {
      // First launch has no local preference file yet.
    }
  }

  Future<void> _loggedIn(AdminSession session, String endpoint) async {
    final file = widget.persistEndpoint ? _endpointFile() : null;
    if (file != null) {
      try {
        await file.parent.create(recursive: true);
        await file.writeAsString(endpoint, flush: true);
      } on FileSystemException {
        // Remembering the endpoint is optional; login itself can still succeed.
      }
    }
    if (!mounted) return;
    setState(() {
      _endpoint = endpoint;
      _session = session;
    });
  }

  File? _endpointFile() {
    final root = Platform.environment['LOCALAPPDATA'];
    if (root == null || root.isEmpty) return null;
    return File('$root\\YingYuAdmin\\service-endpoint.txt');
  }

  Future<void> _logout() async {
    await _api.logout();
    if (mounted) setState(() => _session = null);
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '影语 · 后台管理端',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _background,
        colorScheme: const ColorScheme.dark(
          primary: _accent,
          secondary: _warning,
          surface: _surface,
          error: _danger,
        ),
        fontFamily: 'Microsoft YaHei UI',
        dividerColor: _border,
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: _background.withValues(alpha: 0.65),
          labelStyle: const TextStyle(color: _muted),
          hintStyle: const TextStyle(color: Color(0xFF586675)),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(9),
            borderSide: const BorderSide(color: _border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(9),
            borderSide: const BorderSide(color: _accent, width: 1.4),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(9),
            borderSide: const BorderSide(color: _danger),
          ),
        ),
        cardTheme: CardThemeData(
          color: _surface,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: _border),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            foregroundColor: const Color(0xFF07130F),
            backgroundColor: _accent,
            minimumSize: const Size(0, 46),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(9),
            ),
          ),
        ),
      ),
      home: _session == null
          ? _AdminLogin(
              api: _api,
              initialEndpoint: _endpoint,
              onLoggedIn: _loggedIn,
            )
          : _AdminDashboard(
              api: _api,
              session: _session!,
              endpoint: _endpoint,
              onLogout: _logout,
            ),
    );
  }
}

class _AdminLogin extends StatefulWidget {
  const _AdminLogin({
    required this.api,
    required this.initialEndpoint,
    required this.onLoggedIn,
  });

  final AdminApi api;
  final String initialEndpoint;
  final Future<void> Function(AdminSession session, String endpoint) onLoggedIn;

  @override
  State<_AdminLogin> createState() => _AdminLoginState();
}

class _AdminLoginState extends State<_AdminLogin> {
  late final TextEditingController _endpoint;
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _endpoint = TextEditingController(text: widget.initialEndpoint);
  }

  @override
  void dispose() {
    _endpoint.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final session = await widget.api.login(
        baseUrl: _endpoint.text,
        username: _username.text.trim(),
        password: _password.text,
      );
      await widget.onLoggedIn(session, _endpoint.text.trim());
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          const _LoginBackdrop(),
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Container(
                  padding: const EdgeInsets.all(30),
                  decoration: BoxDecoration(
                    color: _surface.withValues(alpha: 0.96),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: _border),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x66000000),
                        blurRadius: 40,
                        offset: Offset(0, 18),
                      ),
                    ],
                  ),
                  child: AutofillGroup(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 46,
                              height: 46,
                              decoration: BoxDecoration(
                                color: _accent.withValues(alpha: 0.13),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(
                                Icons.shield_outlined,
                                color: _accent,
                                size: 25,
                              ),
                            ),
                            const SizedBox(width: 14),
                            const Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '影语后台管理端',
                                  style: TextStyle(
                                    color: _text,
                                    fontSize: 21,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  '独立管理员入口',
                                  style: TextStyle(color: _muted, fontSize: 12),
                                ),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: 27),
                        TextField(
                          controller: _endpoint,
                          keyboardType: TextInputType.url,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: '后台服务地址',
                            prefixIcon: Icon(Icons.dns_outlined),
                          ),
                        ),
                        const SizedBox(height: 13),
                        TextField(
                          controller: _username,
                          autofocus: true,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.username],
                          decoration: const InputDecoration(
                            labelText: '管理员用户名',
                            prefixIcon: Icon(Icons.person_outline_rounded),
                          ),
                        ),
                        const SizedBox(height: 13),
                        TextField(
                          controller: _password,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.password],
                          onSubmitted: (_) => _login(),
                          decoration: InputDecoration(
                            labelText: '管理员密码',
                            prefixIcon: const Icon(Icons.lock_outline_rounded),
                            suffixIcon: IconButton(
                              tooltip: _obscurePassword ? '显示密码' : '隐藏密码',
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                            ),
                          ),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 13),
                          _MessageBanner(
                            icon: Icons.error_outline_rounded,
                            message: _error!,
                            danger: true,
                          ),
                        ],
                        const SizedBox(height: 20),
                        FilledButton.icon(
                          onPressed: _loading ? null : _login,
                          icon: _loading
                              ? const SizedBox(
                                  width: 17,
                                  height: 17,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.login_rounded),
                          label: const Text('进入管理后台'),
                        ),
                        const SizedBox(height: 13),
                        const Text(
                          '此应用不提供普通用户注册。管理员账户仅由服务端安全配置创建。',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _muted,
                            fontSize: 11,
                            height: 1.45,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LoginBackdrop extends StatelessWidget {
  const _LoginBackdrop();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(-0.48, -0.45),
          radius: 1.15,
          colors: [Color(0xFF17322F), _background],
        ),
      ),
      child: CustomPaint(painter: _GridPainter()),
    );
  }
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.025)
      ..strokeWidth = 1;
    for (double x = 0; x < size.width; x += 44) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += 44) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _AdminDashboard extends StatefulWidget {
  const _AdminDashboard({
    required this.api,
    required this.session,
    required this.endpoint,
    required this.onLogout,
  });

  final AdminApi api;
  final AdminSession session;
  final String endpoint;
  final Future<void> Function() onLogout;

  @override
  State<_AdminDashboard> createState() => _AdminDashboardState();
}

class _AdminDashboardState extends State<_AdminDashboard> {
  final _search = TextEditingController();
  List<ManagedAccount> _accounts = const [];
  AdminOverview _overview = AdminOverview.zero;
  AdminPricing _pricing = AdminPricing.fallback;
  bool _loading = true;
  bool _savingPricing = false;
  bool _switchingModel = false;
  String? _updatingAccountId;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading && _accounts.isNotEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final dashboard = await widget.api.dashboard(query: _search.text);
      if (mounted) {
        setState(() {
          _accounts = dashboard.accounts;
          _overview = dashboard.overview;
          _pricing = dashboard.pricing;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _update(
    ManagedAccount account, {
    bool? disabled,
    String? role,
    int? balanceAdjustment,
  }) async {
    setState(() {
      _updatingAccountId = account.accountId;
      _error = null;
    });
    try {
      final updated = await widget.api.updateAccount(
        accountId: account.accountId,
        disabled: disabled,
        role: role,
        balanceAdjustment: balanceAdjustment,
      );
      if (!mounted) return;
      setState(() {
        _accounts = [
          for (final item in _accounts)
            if (item.accountId == updated.accountId) updated else item,
        ];
      });
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _updatingAccountId = null);
    }
  }

  Future<void> _adjustBalance(ManagedAccount account) async {
    final controller = TextEditingController();
    final amount = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('调整 ${account.displayName} 的额度'),
        content: SizedBox(
          width: 390,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '当前余额：${account.balanceCredits} 点',
                style: const TextStyle(color: _muted),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: controller,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(
                  signed: true,
                ),
                decoration: const InputDecoration(
                  labelText: '增减额度',
                  hintText: '例如 100 或 -20',
                ),
                onSubmitted: (value) {
                  final parsed = int.tryParse(value.trim());
                  if (parsed != null && parsed != 0) {
                    Navigator.of(context).pop(parsed);
                  }
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              final parsed = int.tryParse(controller.text.trim());
              if (parsed != null && parsed != 0) {
                Navigator.of(context).pop(parsed);
              }
            },
            child: const Text('确认调整'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (amount != null && mounted) {
      await _update(account, balanceAdjustment: amount);
    }
  }

  Future<void> _editPricing() async {
    final draft = await showDialog<_PricingDraft>(
      context: context,
      builder: (context) => _PricingDialog(pricing: _pricing),
    );
    if (draft == null || !mounted) return;
    setState(() {
      _savingPricing = true;
      _error = null;
    });
    try {
      final pricing = await widget.api.updatePricing(
        initialCredits: draft.initialCredits,
        minimumBalanceToStart: draft.minimumBalanceToStart,
        minimumChargeCredits: draft.minimumChargeCredits,
        creditsPerCurrencyUnit: draft.creditsPerCurrencyUnit,
        markupMultiplier: draft.markupMultiplier,
      );
      if (!mounted) return;
      setState(() => _pricing = pricing);
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _savingPricing = false);
    }
  }

  Future<void> _editModel() async {
    setState(() {
      _switchingModel = true;
      _error = null;
    });
    try {
      final catalog = await widget.api.models(refresh: true);
      if (!mounted) return;
      setState(() => _switchingModel = false);
      final draft = await showDialog<_ModelSwitchDraft>(
        context: context,
        builder: (context) => _ModelSwitchDialog(catalog: catalog),
      );
      if (draft == null || !mounted) return;
      setState(() => _switchingModel = true);
      final pricing = await widget.api.switchModel(
        modelId: draft.modelId,
        manualCurrency: draft.manualCurrency,
        manualTiers: draft.manualTiers,
      );
      if (!mounted) return;
      setState(() => _pricing = pricing);
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _switchingModel = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final overview = _overview;

    return Scaffold(
      body: Row(
        children: [
          _AdminSidebar(
            session: widget.session,
            endpoint: widget.endpoint,
            onLogout: widget.onLogout,
          ),
          Expanded(
            child: Column(
              children: [
                _DashboardHeader(
                  loading: _loading,
                  savingPricing: _savingPricing,
                  switchingModel: _switchingModel,
                  pricing: _pricing,
                  onRefresh: _load,
                  onPricing: _editPricing,
                  onModel: _editModel,
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(26, 2, 26, 26),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            _MetricCard(
                              label: '全部账户',
                              value: '${overview.accountCount}',
                              icon: Icons.groups_2_outlined,
                            ),
                            _MetricCard(
                              label: '注册用户',
                              value: '${overview.registeredAccountCount}',
                              icon: Icons.person_outline_rounded,
                            ),
                            _MetricCard(
                              label: '邮箱已验证',
                              value: '${overview.verifiedEmailCount}',
                              icon: Icons.mark_email_read_outlined,
                              accent: _accent,
                            ),
                            _MetricCard(
                              label: '已停用',
                              value: '${overview.disabledAccountCount}',
                              icon: Icons.block_outlined,
                              accent: overview.disabledAccountCount > 0
                                  ? _danger
                                  : _muted,
                            ),
                            _MetricCard(
                              label: '总剩余额度',
                              value: '${overview.totalBalanceCredits}',
                              icon: Icons.toll_outlined,
                              accent: _warning,
                            ),
                            _MetricCard(
                              label: 'Token 总量',
                              value: _formatTokens(overview.usage.totalTokens),
                              icon: Icons.data_usage_rounded,
                            ),
                            _MetricCard(
                              label: '实际扣除额度',
                              value: '${overview.usage.chargedCredits}',
                              icon: Icons.receipt_long_outlined,
                              accent: _warning,
                            ),
                            _MetricCard(
                              label: '当前费率预估扣点',
                              value: '${overview.usage.estimatedCredits}',
                              icon: Icons.calculate_outlined,
                              accent: const Color(0xFF8EB8F5),
                            ),
                            _MetricCard(
                              label: '模型目录价预估',
                              value: _formatMicros(
                                overview.usage.cost.providerCostMicros,
                                overview.usage.cost.currency,
                              ),
                              icon: Icons.cloud_outlined,
                              accent: const Color(0xFF8EB8F5),
                            ),
                            _MetricCard(
                              label: '历史扣点折算金额',
                              value: _formatMicros(
                                overview.usage.cost.actualBilledMicros,
                                overview.usage.cost.currency,
                              ),
                              icon: Icons.price_check_outlined,
                              accent: _warning,
                            ),
                            _MetricCard(
                              label: '当前费率预估金额',
                              value: _formatMicros(
                                overview.usage.cost.estimatedBilledMicros,
                                overview.usage.cost.currency,
                              ),
                              icon: Icons.calculate_outlined,
                              accent: const Color(0xFFB79AF4),
                            ),
                            _MetricCard(
                              label: '扣点－目录价差',
                              value: _formatMicros(
                                overview.usage.cost.grossProfitMicros,
                                overview.usage.cost.currency,
                              ),
                              icon: Icons.trending_up_rounded,
                              accent: overview.usage.cost.grossProfitMicros >= 0
                                  ? _accent
                                  : _danger,
                            ),
                            _MetricCard(
                              label: '累计充值额度',
                              value: '${overview.funding.topUpCredits}',
                              icon: Icons.add_card_outlined,
                            ),
                            _MetricCard(
                              label: '实收充值金额',
                              value: _formatPaidAmounts(
                                overview.funding.paidAmounts,
                              ),
                              icon: Icons.payments_outlined,
                              accent: const Color(0xFFB79AF4),
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        if (_error != null) ...[
                          _MessageBanner(
                            icon: Icons.error_outline_rounded,
                            message: _error!,
                            danger: true,
                          ),
                          const SizedBox(height: 12),
                        ],
                        Container(
                          decoration: BoxDecoration(
                            color: _surface,
                            borderRadius: BorderRadius.circular(13),
                            border: Border.all(color: _border),
                          ),
                          child: Column(
                            children: [
                              Padding(
                                padding: const EdgeInsets.all(16),
                                child: Row(
                                  children: [
                                    const Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '账户列表',
                                            style: TextStyle(
                                              color: _text,
                                              fontSize: 16,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                          SizedBox(height: 3),
                                          Text(
                                            '逐账户查看 Token、计费、充值、角色与状态',
                                            style: TextStyle(
                                              color: _muted,
                                              fontSize: 11.5,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    SizedBox(
                                      width: 330,
                                      child: TextField(
                                        controller: _search,
                                        textInputAction: TextInputAction.search,
                                        onSubmitted: (_) => _load(),
                                        decoration: InputDecoration(
                                          isDense: true,
                                          hintText: '用户名、邮箱、昵称或账户 ID',
                                          prefixIcon: const Icon(
                                            Icons.search_rounded,
                                          ),
                                          suffixIcon: IconButton(
                                            tooltip: '搜索',
                                            onPressed: _loading ? null : _load,
                                            icon: const Icon(
                                              Icons.arrow_forward_rounded,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Divider(height: 1),
                              LayoutBuilder(
                                builder: (context, constraints) {
                                  final compact = constraints.maxWidth < 1080;
                                  if (_loading && _accounts.isEmpty) {
                                    return const SizedBox(
                                      height: 330,
                                      child: Center(
                                        child: CircularProgressIndicator(),
                                      ),
                                    );
                                  }
                                  if (_accounts.isEmpty) {
                                    return const SizedBox(
                                      height: 260,
                                      child: Center(
                                        child: Text(
                                          '没有匹配账户',
                                          style: TextStyle(color: _muted),
                                        ),
                                      ),
                                    );
                                  }
                                  return Column(
                                    children: [
                                      for (
                                        var index = 0;
                                        index < _accounts.length;
                                        index++
                                      ) ...[
                                        _AccountRow(
                                          account: _accounts[index],
                                          currentAdminId:
                                              widget.session.accountId,
                                          compact: compact,
                                          updating:
                                              _updatingAccountId ==
                                              _accounts[index].accountId,
                                          onAdjustBalance: () =>
                                              _adjustBalance(_accounts[index]),
                                          onToggleDisabled: () => _update(
                                            _accounts[index],
                                            disabled:
                                                !_accounts[index].disabled,
                                          ),
                                          onToggleRole: () => _update(
                                            _accounts[index],
                                            role: _accounts[index].isAdmin
                                                ? 'user'
                                                : 'admin',
                                          ),
                                        ),
                                        if (index != _accounts.length - 1)
                                          const Divider(height: 1),
                                      ],
                                    ],
                                  );
                                },
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AdminSidebar extends StatelessWidget {
  const _AdminSidebar({
    required this.session,
    required this.endpoint,
    required this.onLogout,
  });

  final AdminSession session;
  final String endpoint;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 228,
      decoration: const BoxDecoration(
        color: Color(0xFF10161D),
        border: Border(right: BorderSide(color: _border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 24, 20, 22),
            child: Row(
              children: [
                Icon(Icons.shield_outlined, color: _accent, size: 25),
                SizedBox(width: 10),
                Text(
                  '影语管理',
                  style: TextStyle(
                    color: _text,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              decoration: BoxDecoration(
                color: _accent.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: _accent.withValues(alpha: 0.18)),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.manage_accounts_outlined,
                    color: _accent,
                    size: 20,
                  ),
                  SizedBox(width: 10),
                  Text(
                    '账户管理',
                    style: TextStyle(
                      color: _accent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Spacer(),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: _surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: _border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '@${session.username}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: _muted, fontSize: 11),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    endpoint,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF667482),
                      fontSize: 10,
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      onPressed: onLogout,
                      icon: const Icon(Icons.logout_rounded, size: 17),
                      label: const Text('退出管理端'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ModelSwitchDraft {
  const _ModelSwitchDraft({
    required this.modelId,
    this.manualCurrency,
    this.manualTiers,
  });

  final String modelId;
  final String? manualCurrency;
  final List<ModelPriceTier>? manualTiers;
}

class _ModelSwitchDialog extends StatefulWidget {
  const _ModelSwitchDialog({required this.catalog});

  final AdminModelCatalog catalog;

  @override
  State<_ModelSwitchDialog> createState() => _ModelSwitchDialogState();
}

class _ModelSwitchDialogState extends State<_ModelSwitchDialog> {
  final _search = TextEditingController();
  final _manualLimit = TextEditingController();
  final _manualInput = TextEditingController();
  final _manualOutput = TextEditingController();
  AvailableModel? _selected;
  String? _error;

  @override
  void initState() {
    super.initState();
    final models = widget.catalog.models;
    _selected = models.cast<AvailableModel?>().firstWhere(
      (model) => model?.id == widget.catalog.activeModelId,
      orElse: () => models.isEmpty ? null : models.first,
    );
    _resetManualFields();
  }

  @override
  void dispose() {
    _search.dispose();
    _manualLimit.dispose();
    _manualInput.dispose();
    _manualOutput.dispose();
    super.dispose();
  }

  void _resetManualFields() {
    final selected = _selected;
    _manualLimit.text =
        '${selected?.maxInputTokens ?? selected?.contextWindow ?? 256000}';
    _manualInput.text = '';
    _manualOutput.text = '';
    _error = null;
  }

  void _select(AvailableModel model) {
    setState(() {
      _selected = model;
      _resetManualFields();
    });
  }

  void _submit() {
    final selected = _selected;
    if (selected == null) {
      setState(() => _error = '没有可切换的文本生成模型。');
      return;
    }
    if (selected.suggestedPricing != null) {
      Navigator.of(context).pop(_ModelSwitchDraft(modelId: selected.id));
      return;
    }
    final limit = int.tryParse(_manualLimit.text.trim());
    final input = double.tryParse(_manualInput.text.trim());
    final output = double.tryParse(_manualOutput.text.trim());
    if (limit == null || limit < 1 || limit > 4000000) {
      setState(() => _error = '价格档输入上限需为 1–4,000,000 的整数。');
      return;
    }
    if (input == null || input < 0 || input > 1000000) {
      setState(() => _error = '请输入有效的每百万输入 Token 目录价。');
      return;
    }
    if (output == null || output < 0 || output > 1000000) {
      setState(() => _error = '请输入有效的每百万输出 Token 目录价。');
      return;
    }
    Navigator.of(context).pop(
      _ModelSwitchDraft(
        modelId: selected.id,
        manualCurrency: 'cny',
        manualTiers: [
          ModelPriceTier(
            upToInputTokens: limit,
            inputPerMillion: input,
            outputPerMillion: output,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final models = widget.catalog.models.where((model) {
      if (query.isEmpty) return true;
      return model.id.toLowerCase().contains(query) ||
          model.name.toLowerCase().contains(query) ||
          (model.domain?.toLowerCase().contains(query) ?? false);
    }).toList();
    final selected = _selected;
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.hub_outlined, color: _accent),
          const SizedBox(width: 10),
          const Expanded(child: Text('切换运行模型')),
          Text(
            '${widget.catalog.models.length} 个文本模型',
            style: const TextStyle(
              color: _muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 860,
        height: 590,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.catalog.warning != null) ...[
              _MessageBanner(
                icon: Icons.info_outline_rounded,
                message: widget.catalog.warning!,
              ),
              const SizedBox(height: 10),
            ],
            TextField(
              controller: _search,
              autofocus: true,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: '搜索模型 ID、名称或类型',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 470,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: _background,
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(color: _border),
                      ),
                      child: models.isEmpty
                          ? const Center(
                              child: Text(
                                '没有匹配模型',
                                style: TextStyle(color: _muted),
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.all(7),
                              itemCount: models.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(height: 5),
                              itemBuilder: (context, index) {
                                final model = models[index];
                                final active =
                                    model.id == widget.catalog.activeModelId;
                                final chosen = model.id == selected?.id;
                                return Material(
                                  color: chosen
                                      ? _accent.withValues(alpha: 0.10)
                                      : Colors.transparent,
                                  borderRadius: BorderRadius.circular(8),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(8),
                                    onTap: () => _select(model),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 11,
                                        vertical: 10,
                                      ),
                                      child: Row(
                                        children: [
                                          Icon(
                                            chosen
                                                ? Icons.radio_button_checked
                                                : Icons.radio_button_off,
                                            color: chosen ? _accent : _muted,
                                            size: 18,
                                          ),
                                          const SizedBox(width: 10),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  model.name,
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                    color: _text,
                                                    fontSize: 12.5,
                                                    fontWeight: FontWeight.w700,
                                                  ),
                                                ),
                                                const SizedBox(height: 2),
                                                Text(
                                                  model.id,
                                                  maxLines: 1,
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                    color: _muted,
                                                    fontSize: 10.5,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                          if (active)
                                            const _ModelBadge(
                                              label: '当前',
                                              color: _accent,
                                            )
                                          else if (model.isRetiring)
                                            const _ModelBadge(
                                              label: '退役中',
                                              color: _warning,
                                            )
                                          else if (model.suggestedPricing !=
                                              null)
                                            const _ModelBadge(
                                              label: '已定价',
                                              color: Color(0xFF8EB8F5),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _ModelDetails(
                      model: selected,
                      manualLimit: _manualLimit,
                      manualInput: _manualInput,
                      manualOutput: _manualOutput,
                    ),
                  ),
                ],
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: _danger)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: selected == null ? null : _submit,
          icon: const Icon(Icons.swap_horiz_rounded, size: 18),
          label: const Text('确认切换'),
        ),
      ],
    );
  }
}

class _ModelBadge extends StatelessWidget {
  const _ModelBadge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(5),
    ),
    child: Text(
      label,
      style: TextStyle(
        color: color,
        fontSize: 9.5,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _ModelDetails extends StatelessWidget {
  const _ModelDetails({
    required this.model,
    required this.manualLimit,
    required this.manualInput,
    required this.manualOutput,
  });

  final AvailableModel? model;
  final TextEditingController manualLimit;
  final TextEditingController manualInput;
  final TextEditingController manualOutput;

  @override
  Widget build(BuildContext context) {
    final value = model;
    if (value == null) {
      return const Center(
        child: Text('请选择模型', style: TextStyle(color: _muted)),
      );
    }
    final pricing = value.suggestedPricing;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: _border),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              value.name,
              style: const TextStyle(
                color: _text,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            SelectableText(
              value.id,
              style: const TextStyle(color: _muted, fontSize: 10.5),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                _ModelBadge(label: value.domain ?? 'LLM', color: _accent),
                if (value.contextWindow != null)
                  _ModelBadge(
                    label: '${_formatTokens(value.contextWindow!)} 上下文',
                    color: const Color(0xFF8EB8F5),
                  ),
                _ModelBadge(
                  label: value.supportsStructuredOutput ? '结构化输出' : '普通文本输出',
                  color: value.supportsStructuredOutput
                      ? const Color(0xFFB79AF4)
                      : _muted,
                ),
              ],
            ),
            if (value.isRetiring) ...[
              const SizedBox(height: 12),
              const Text(
                '此模型处于退役期，切换后可能需要在下线前再次迁移。',
                style: TextStyle(color: _warning, fontSize: 11.5),
              ),
            ],
            const SizedBox(height: 17),
            Text(
              pricing == null ? '手动填写目录价' : '官方目录价',
              style: const TextStyle(color: _text, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            if (pricing != null) ...[
              for (final tier in pricing.tiers)
                Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Text(
                    '≤ ${_formatTokens(tier.upToInputTokens)} 输入：${tier.inputPerMillion} / 输出：${tier.outputPerMillion} ${pricing.currency.toUpperCase()}/百万 Token',
                    style: const TextStyle(color: _muted, fontSize: 11),
                  ),
                ),
              if (pricing.checkedAt != null)
                Text(
                  '核对日期 ${pricing.checkedAt}',
                  style: const TextStyle(color: _muted, fontSize: 10.5),
                ),
            ] else ...[
              const Text(
                '此模型尚无内置价格。为避免成本预估和扣点失真，切换前需填写 CNY 目录价。',
                style: TextStyle(color: _muted, fontSize: 11),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: manualLimit,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '输入 Token 上限'),
              ),
              const SizedBox(height: 9),
              TextField(
                controller: manualInput,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: '输入价 / 百万 Token（CNY）',
                ),
              ),
              const SizedBox(height: 9),
              TextField(
                controller: manualOutput,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: '输出价 / 百万 Token（CNY）',
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PricingDraft {
  const _PricingDraft({
    required this.initialCredits,
    required this.minimumBalanceToStart,
    required this.minimumChargeCredits,
    required this.creditsPerCurrencyUnit,
    required this.markupMultiplier,
  });

  final int initialCredits;
  final int minimumBalanceToStart;
  final int minimumChargeCredits;
  final int creditsPerCurrencyUnit;
  final double markupMultiplier;
}

class _PricingDialog extends StatefulWidget {
  const _PricingDialog({required this.pricing});

  final AdminPricing pricing;

  @override
  State<_PricingDialog> createState() => _PricingDialogState();
}

class _PricingDialogState extends State<_PricingDialog> {
  late final TextEditingController _initial;
  late final TextEditingController _minimumBalance;
  late final TextEditingController _minimumCharge;
  late final TextEditingController _creditsPerUnit;
  late final TextEditingController _markup;
  String? _error;

  @override
  void initState() {
    super.initState();
    final pricing = widget.pricing;
    _initial = TextEditingController(text: '${pricing.initialCredits}');
    _minimumBalance = TextEditingController(
      text: '${pricing.minimumBalanceToStart}',
    );
    _minimumCharge = TextEditingController(
      text: '${pricing.minimumChargeCredits}',
    );
    _creditsPerUnit = TextEditingController(
      text: '${pricing.creditsPerCurrencyUnit}',
    );
    _markup = TextEditingController(
      text: pricing.markupMultiplier.toStringAsFixed(2),
    );
  }

  @override
  void dispose() {
    _initial.dispose();
    _minimumBalance.dispose();
    _minimumCharge.dispose();
    _creditsPerUnit.dispose();
    _markup.dispose();
    super.dispose();
  }

  void _submit() {
    final initial = int.tryParse(_initial.text.trim());
    final minimumBalance = int.tryParse(_minimumBalance.text.trim());
    final minimumCharge = int.tryParse(_minimumCharge.text.trim());
    final creditsPerUnit = int.tryParse(_creditsPerUnit.text.trim());
    final markup = double.tryParse(_markup.text.trim());
    if (initial == null || initial < 0 || initial > 1000000) {
      setState(() => _error = '新账户赠送点数需为 0–1,000,000 的整数。');
      return;
    }
    if (minimumBalance == null ||
        minimumBalance < 0 ||
        minimumBalance > 1000000) {
      setState(() => _error = '最低请求余额需为 0–1,000,000 的整数。');
      return;
    }
    if (minimumCharge == null || minimumCharge < 0 || minimumCharge > 1000000) {
      setState(() => _error = '单次最低扣点需为 0–1,000,000 的整数。');
      return;
    }
    if (creditsPerUnit == null ||
        creditsPerUnit < 1 ||
        creditsPerUnit > 1000000) {
      setState(() => _error = '每货币单位点数需为 1–1,000,000 的整数。');
      return;
    }
    if (markup == null || markup < 0.01 || markup > 1000) {
      setState(() => _error = '成本倍率需在 0.01–1000 之间。');
      return;
    }
    Navigator.of(context).pop(
      _PricingDraft(
        initialCredits: initial,
        minimumBalanceToStart: minimumBalance,
        minimumChargeCredits: minimumCharge,
        creditsPerCurrencyUnit: creditsPerUnit,
        markupMultiplier: markup,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pricing = widget.pricing;
    final perCredit = 1 / (int.tryParse(_creditsPerUnit.text) ?? 100);
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.tune_rounded, color: _accent),
          SizedBox(width: 10),
          Text('模型价格与点数费率'),
        ],
      ),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: _accent.withValues(alpha: 0.07),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: _accent.withValues(alpha: 0.18)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      pricing.profile,
                      style: const TextStyle(
                        color: _text,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    for (final tier in pricing.tiers)
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          '输入 ≤ ${_formatTokens(tier.upToInputTokens)}：输入 ${tier.inputPerMillion}/百万 Token · 输出 ${tier.outputPerMillion}/百万 Token',
                          style: const TextStyle(color: _muted, fontSize: 11.5),
                        ),
                      ),
                    if (pricing.checkedAt != null) ...[
                      const SizedBox(height: 7),
                      Text(
                        '价格核对日期 ${pricing.checkedAt} · ${pricing.currency.toUpperCase()}',
                        style: const TextStyle(color: _muted, fontSize: 10.5),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  _PricingField(
                    controller: _creditsPerUnit,
                    label: '每 1 ${pricing.currency.toUpperCase()} 对应点数',
                    hint: '100',
                    onChanged: (_) => setState(() {}),
                  ),
                  _PricingField(
                    controller: _markup,
                    label: '供应商成本倍率',
                    hint: '2.00',
                    decimal: true,
                  ),
                  _PricingField(
                    controller: _minimumCharge,
                    label: '每次模型调用最低扣点',
                    hint: '1',
                  ),
                  _PricingField(
                    controller: _minimumBalance,
                    label: '发起请求最低余额',
                    hint: '2',
                  ),
                  _PricingField(
                    controller: _initial,
                    label: '新账户赠送点数',
                    hint: '100',
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                '当前换算：1 点 ≈ ${_formatMicros((perCredit * 1000000).round(), pricing.currency)}；扣点 = 模型官方成本 × 倍率 × 点数换算，最后向上取整且不低于单次最低扣点。',
                style: const TextStyle(color: _muted, fontSize: 11.5),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: _danger)),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.save_outlined, size: 18),
          label: const Text('保存费率'),
        ),
      ],
    );
  }
}

class _PricingField extends StatelessWidget {
  const _PricingField({
    required this.controller,
    required this.label,
    required this.hint,
    this.decimal = false,
    this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final bool decimal;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 210,
    child: TextField(
      controller: controller,
      keyboardType: TextInputType.numberWithOptions(decimal: decimal),
      onChanged: onChanged,
      decoration: InputDecoration(labelText: label, hintText: hint),
    ),
  );
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({
    required this.loading,
    required this.savingPricing,
    required this.switchingModel,
    required this.pricing,
    required this.onRefresh,
    required this.onPricing,
    required this.onModel,
  });

  final bool loading;
  final bool savingPricing;
  final bool switchingModel;
  final AdminPricing pricing;
  final VoidCallback onRefresh;
  final VoidCallback onPricing;
  final VoidCallback onModel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(26, 22, 26, 18),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '账户控制台',
                  style: TextStyle(
                    color: _text,
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '${pricing.modelId} · ${pricing.creditsPerCurrencyUnit} 点/${pricing.currency.toUpperCase()} · ${pricing.markupMultiplier.toStringAsFixed(2)}×',
                  style: const TextStyle(color: _muted, fontSize: 12),
                ),
              ],
            ),
          ),
          OutlinedButton.icon(
            onPressed: savingPricing ? null : onPricing,
            icon: savingPricing
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.tune_rounded, size: 18),
            label: const Text('费率设置'),
          ),
          const SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: switchingModel ? null : onModel,
            icon: switchingModel
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.hub_outlined, size: 18),
            label: const Text('模型切换'),
          ),
          const SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: loading ? null : onRefresh,
            icon: loading
                ? const SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('刷新'),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
    this.accent = _accent,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 184,
      child: Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: _surface,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: _border),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.11),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, color: accent, size: 20),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    value,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _text,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    label,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: _muted, fontSize: 10.5),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({
    required this.account,
    required this.currentAdminId,
    required this.compact,
    required this.updating,
    required this.onAdjustBalance,
    required this.onToggleDisabled,
    required this.onToggleRole,
  });

  final ManagedAccount account;
  final String currentAdminId;
  final bool compact;
  final bool updating;
  final VoidCallback onAdjustBalance;
  final VoidCallback onToggleDisabled;
  final VoidCallback onToggleRole;

  @override
  Widget build(BuildContext context) {
    final isSelf = account.accountId == currentAdminId;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: account.disabled
                ? Colors.white.withValues(alpha: 0.05)
                : _accent.withValues(alpha: 0.10),
            child: Icon(
              account.isGuest
                  ? Icons.devices_outlined
                  : Icons.person_outline_rounded,
              size: 20,
              color: account.disabled ? _muted : _accent,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        account.displayName,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _text,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (isSelf) ...[
                      const SizedBox(width: 6),
                      const _Badge(label: '当前账户', color: _accent),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  account.isGuest
                      ? '设备访客 · ${_shortId(account.accountId)}'
                      : '@${account.username} · ${_shortId(account.accountId)}',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: _muted, fontSize: 10.5),
                ),
              ],
            ),
          ),
          if (!compact)
            Expanded(
              flex: 3,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    account.email ?? '未绑定邮箱',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: account.email == null ? _muted : _text,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Icon(
                        account.emailVerified
                            ? Icons.verified_rounded
                            : Icons.remove_circle_outline_rounded,
                        color: account.emailVerified ? _accent : _muted,
                        size: 13,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        account.emailVerified ? '邮箱已验证' : '邮箱未验证',
                        style: TextStyle(
                          color: account.emailVerified ? _accent : _muted,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          _AccountStat(label: '余额', value: '${account.balanceCredits} 点'),
          if (!compact) ...[
            _AccountStat(
              label: 'Token',
              value: _formatTokens(account.usage.totalTokens),
              detail:
                  '入 ${_formatTokens(account.usage.inputTokens)} · 出 ${_formatTokens(account.usage.outputTokens)}',
            ),
            _AccountStat(
              label: '实际 / 预估计费',
              value: '${account.usage.chargedCredits} 点',
              detail:
                  '目录成本 ${_formatMicros(account.usage.cost.providerCostMicros, account.usage.cost.currency)} · 扣点折算 ${_formatMicros(account.usage.cost.actualBilledMicros, account.usage.cost.currency)}',
            ),
            _AccountStat(
              label: '充值',
              value: '${account.funding.topUpCredits} 点',
              detail: _formatPaidAmounts(account.funding.paidAmounts),
            ),
          ],
          SizedBox(
            width: 76,
            child: Align(
              alignment: Alignment.centerLeft,
              child: _Badge(
                label: account.isAdmin ? '管理员' : '普通用户',
                color: account.isAdmin ? _warning : _muted,
              ),
            ),
          ),
          SizedBox(
            width: 62,
            child: _Badge(
              label: account.disabled ? '已停用' : '正常',
              color: account.disabled ? _danger : _accent,
            ),
          ),
          const SizedBox(width: 8),
          if (updating)
            const SizedBox(
              width: 38,
              height: 38,
              child: Padding(
                padding: EdgeInsets.all(10),
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            PopupMenuButton<String>(
              tooltip: '账户操作',
              onSelected: (action) {
                switch (action) {
                  case 'balance':
                    onAdjustBalance();
                  case 'disabled':
                    onToggleDisabled();
                  case 'role':
                    onToggleRole();
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'balance',
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.toll_outlined),
                    title: Text('调整额度'),
                  ),
                ),
                PopupMenuItem(
                  value: 'disabled',
                  enabled: !isSelf,
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      account.disabled
                          ? Icons.check_circle_outline_rounded
                          : Icons.block_outlined,
                    ),
                    title: Text(account.disabled ? '恢复账户' : '停用账户'),
                  ),
                ),
                if (!account.isGuest)
                  PopupMenuItem(
                    value: 'role',
                    enabled: !isSelf,
                    child: ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.admin_panel_settings_outlined),
                      title: Text(account.isAdmin ? '移除管理员权限' : '设为管理员'),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  static String _shortId(String id) => id.length <= 8 ? id : id.substring(0, 8);
}

class _AccountStat extends StatelessWidget {
  const _AccountStat({required this.label, required this.value, this.detail});

  final String label;
  final String value;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      flex: 2,
      child: Padding(
        padding: const EdgeInsets.only(left: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: _muted, fontSize: 9.5),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: _text,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (detail != null) ...[
              const SizedBox(height: 2),
              Text(
                detail!,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: _muted, fontSize: 9),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.20)),
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: TextStyle(
          color: color,
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _MessageBanner extends StatelessWidget {
  const _MessageBanner({
    required this.icon,
    required this.message,
    this.danger = false,
  });

  final IconData icon;
  final String message;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? _danger : _accent;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: color, fontSize: 11.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
