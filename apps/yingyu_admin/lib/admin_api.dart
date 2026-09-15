import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'admin_models.dart';

class AdminApiException implements Exception {
  const AdminApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class AdminApi {
  AdminApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  Uri? _baseUri;
  AdminSession? _session;

  AdminSession? get session => _session;

  Uri _uri(String path, {Map<String, String>? query}) {
    final base = _baseUri;
    if (base == null) throw const AdminApiException('尚未连接管理服务。');
    final rootPath = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    return base.replace(path: '$rootPath$path', queryParameters: query);
  }

  Future<AdminSession> login({
    required String baseUrl,
    required String username,
    required String password,
  }) async {
    final normalized = baseUrl.trim().replaceAll(RegExp(r'/$'), '');
    final parsed = Uri.tryParse(normalized);
    if (parsed == null || !parsed.hasScheme || parsed.host.isEmpty) {
      throw const AdminApiException('请输入有效的后台服务地址。');
    }
    final loopback =
        parsed.host == '127.0.0.1' ||
        parsed.host == 'localhost' ||
        parsed.host == '::1';
    if (parsed.scheme != 'https' && !(parsed.scheme == 'http' && loopback)) {
      throw const AdminApiException('远程后台地址必须使用 HTTPS。');
    }
    _baseUri = parsed;
    final response = await _client
        .post(
          _uri('/api/admin/auth/login'),
          headers: const {
            'content-type': 'application/json',
            'accept': 'application/json',
          },
          body: jsonEncode({'username': username, 'password': password}),
        )
        .timeout(const Duration(seconds: 30));
    final json = _decode(response);
    final token = json['accessToken'] as String? ?? '';
    if (token.length < 32) {
      throw const AdminApiException('服务端没有返回有效的管理员凭据。');
    }
    try {
      _session = AdminSession.fromJson(json, token);
    } on FormatException catch (error) {
      throw AdminApiException(error.message);
    }
    return _session!;
  }

  Future<AdminDashboardData> dashboard({String query = ''}) async {
    final response = await _client
        .get(
          _uri(
            '/api/admin/accounts',
            query: query.trim().isEmpty ? null : {'query': query.trim()},
          ),
          headers: _authenticatedHeaders(),
        )
        .timeout(const Duration(seconds: 30));
    final json = _decode(response);
    return AdminDashboardData.fromJson(json);
  }

  Future<ManagedAccount> updateAccount({
    required String accountId,
    bool? disabled,
    String? role,
    int? balanceAdjustment,
  }) async {
    final response = await _client
        .patch(
          _uri('/api/admin/accounts/$accountId'),
          headers: {
            ..._authenticatedHeaders(),
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'disabled': ?disabled,
            'role': ?role,
            'balanceAdjustment': ?balanceAdjustment,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final json = _decode(response);
    final account = json['account'];
    if (account is! Map) {
      throw const AdminApiException('服务端没有返回有效的账户。');
    }
    return ManagedAccount.fromJson(
      account.map((key, value) => MapEntry(key.toString(), value as Object?)),
    );
  }

  Future<AdminPricing> updatePricing({
    required int initialCredits,
    required int minimumBalanceToStart,
    required int minimumChargeCredits,
    required int creditsPerCurrencyUnit,
    required double markupMultiplier,
  }) async {
    final response = await _client
        .patch(
          _uri('/api/admin/pricing'),
          headers: {
            ..._authenticatedHeaders(),
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'initialCredits': initialCredits,
            'minimumBalanceToStart': minimumBalanceToStart,
            'minimumChargeCredits': minimumChargeCredits,
            'creditsPerCurrencyUnit': creditsPerCurrencyUnit,
            'markupMultiplier': markupMultiplier,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final json = _decode(response);
    return AdminPricing.fromJson(json['pricing']);
  }

  Future<AdminModelCatalog> models({bool refresh = false}) async {
    final response = await _client
        .get(
          _uri(
            '/api/admin/models',
            query: refresh ? const {'refresh': 'true'} : null,
          ),
          headers: _authenticatedHeaders(),
        )
        .timeout(const Duration(seconds: 45));
    return AdminModelCatalog.fromJson(_decode(response));
  }

  Future<AdminPricing> switchModel({
    required String modelId,
    String? manualCurrency,
    List<ModelPriceTier>? manualTiers,
  }) async {
    final hasManualPricing =
        manualCurrency != null && manualTiers != null && manualTiers.isNotEmpty;
    final response = await _client
        .patch(
          _uri('/api/admin/model'),
          headers: {
            ..._authenticatedHeaders(),
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'modelId': modelId,
            if (hasManualPricing)
              'pricing': {
                'currency': manualCurrency,
                'tiers': [
                  for (final tier in manualTiers)
                    {
                      'upToInputTokens': tier.upToInputTokens,
                      'inputPerMillion': tier.inputPerMillion,
                      'outputPerMillion': tier.outputPerMillion,
                    },
                ],
              },
          }),
        )
        .timeout(const Duration(seconds: 45));
    final json = _decode(response);
    return AdminPricing.fromJson(json['pricing']);
  }

  Future<void> logout() async {
    final session = _session;
    _session = null;
    if (session == null || _baseUri == null) return;
    try {
      await _client
          .post(
            _uri('/api/auth/logout'),
            headers: {
              'authorization': 'Bearer ${session.accessToken}',
              'accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      // The local session is cleared even if the server is unavailable.
    }
  }

  Map<String, String> _authenticatedHeaders() {
    final session = _session;
    if (session == null) throw const AdminApiException('管理员会话已失效。');
    return {
      'authorization': 'Bearer ${session.accessToken}',
      'accept': 'application/json',
    };
  }

  Map<String, Object?> _decode(http.Response response) {
    Object? value;
    try {
      value = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        throw const AdminApiException('服务端返回了无法识别的数据。');
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = value is Map && value['error'] is String
          ? value['error'] as String
          : 'HTTP ${response.statusCode}';
      throw AdminApiException(message);
    }
    if (value is! Map) {
      throw const AdminApiException('服务端返回了无法识别的数据。');
    }
    return value.map(
      (key, value) => MapEntry(key.toString(), value as Object?),
    );
  }

  void close() => _client.close();
}
