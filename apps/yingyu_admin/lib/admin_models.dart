Map<String, Object?> _objectMap(Object? value) => value is Map
    ? value.map((key, value) => MapEntry(key.toString(), value as Object?))
    : const <String, Object?>{};

class AdminSession {
  const AdminSession({
    required this.accountId,
    required this.username,
    required this.displayName,
    required this.accessToken,
  });

  factory AdminSession.fromJson(Map<String, Object?> json, String accessToken) {
    final accountMap = _objectMap(json['account']);
    final profileMap = _objectMap(accountMap['profile']);
    if (profileMap['role'] != 'admin') {
      throw const FormatException('当前账户不是管理员。');
    }
    return AdminSession(
      accountId: accountMap['accountId'] as String? ?? '',
      username: profileMap['username'] as String? ?? '',
      displayName: profileMap['displayName'] as String? ?? '管理员',
      accessToken: accessToken,
    );
  }

  final String accountId;
  final String username;
  final String displayName;
  final String accessToken;
}

class UsageMetrics {
  const UsageMetrics({
    required this.inputTokens,
    required this.outputTokens,
    required this.totalTokens,
    required this.chargedCredits,
    required this.estimatedCredits,
    required this.cost,
  });

  factory UsageMetrics.fromJson(Object? value) {
    final json = _objectMap(value);
    return UsageMetrics(
      inputTokens: (json['inputTokens'] as num?)?.toInt() ?? 0,
      outputTokens: (json['outputTokens'] as num?)?.toInt() ?? 0,
      totalTokens: (json['totalTokens'] as num?)?.toInt() ?? 0,
      chargedCredits: (json['chargedCredits'] as num?)?.toInt() ?? 0,
      estimatedCredits: (json['estimatedCredits'] as num?)?.toInt() ?? 0,
      cost: UsageCostMetrics.fromJson(json['cost']),
    );
  }

  static const zero = UsageMetrics(
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    chargedCredits: 0,
    estimatedCredits: 0,
    cost: UsageCostMetrics.zero,
  );

  final int inputTokens;
  final int outputTokens;
  final int totalTokens;
  final int chargedCredits;
  final int estimatedCredits;
  final UsageCostMetrics cost;
}

class UsageCostMetrics {
  const UsageCostMetrics({
    required this.currency,
    required this.providerCostMicros,
    required this.actualBilledMicros,
    required this.estimatedBilledMicros,
    required this.grossProfitMicros,
  });

  factory UsageCostMetrics.fromJson(Object? value) {
    final json = _objectMap(value);
    return UsageCostMetrics(
      currency: json['currency'] as String? ?? 'cny',
      providerCostMicros: (json['providerCostMicros'] as num?)?.toInt() ?? 0,
      actualBilledMicros: (json['actualBilledMicros'] as num?)?.toInt() ?? 0,
      estimatedBilledMicros:
          (json['estimatedBilledMicros'] as num?)?.toInt() ?? 0,
      grossProfitMicros: (json['grossProfitMicros'] as num?)?.toInt() ?? 0,
    );
  }

  static const zero = UsageCostMetrics(
    currency: 'cny',
    providerCostMicros: 0,
    actualBilledMicros: 0,
    estimatedBilledMicros: 0,
    grossProfitMicros: 0,
  );

  final String currency;
  final int providerCostMicros;
  final int actualBilledMicros;
  final int estimatedBilledMicros;
  final int grossProfitMicros;
}

class PaidAmount {
  const PaidAmount({required this.currency, required this.amountMinor});

  factory PaidAmount.fromJson(Object? value) {
    final json = _objectMap(value);
    return PaidAmount(
      currency: json['currency'] as String? ?? '',
      amountMinor: (json['amountMinor'] as num?)?.toInt() ?? 0,
    );
  }

  final String currency;
  final int amountMinor;
}

class FundingMetrics {
  const FundingMetrics({
    required this.initialGrantCredits,
    required this.topUpCredits,
    required this.topUpCount,
    required this.adminAdjustmentCredits,
    required this.paidAmounts,
  });

  factory FundingMetrics.fromJson(Object? value) {
    final json = _objectMap(value);
    return FundingMetrics(
      initialGrantCredits: (json['initialGrantCredits'] as num?)?.toInt() ?? 0,
      topUpCredits: (json['topUpCredits'] as num?)?.toInt() ?? 0,
      topUpCount: (json['topUpCount'] as num?)?.toInt() ?? 0,
      adminAdjustmentCredits:
          (json['adminAdjustmentCredits'] as num?)?.toInt() ?? 0,
      paidAmounts: [
        for (final item in json['paidAmounts'] as List? ?? const [])
          PaidAmount.fromJson(item),
      ],
    );
  }

  static const zero = FundingMetrics(
    initialGrantCredits: 0,
    topUpCredits: 0,
    topUpCount: 0,
    adminAdjustmentCredits: 0,
    paidAmounts: [],
  );

  final int initialGrantCredits;
  final int topUpCredits;
  final int topUpCount;
  final int adminAdjustmentCredits;
  final List<PaidAmount> paidAmounts;
}

class AdminOverview {
  const AdminOverview({
    required this.accountCount,
    required this.registeredAccountCount,
    required this.verifiedEmailCount,
    required this.disabledAccountCount,
    required this.totalBalanceCredits,
    required this.usage,
    required this.funding,
  });

  factory AdminOverview.fromJson(Object? value) {
    final json = _objectMap(value);
    return AdminOverview(
      accountCount: (json['accountCount'] as num?)?.toInt() ?? 0,
      registeredAccountCount:
          (json['registeredAccountCount'] as num?)?.toInt() ?? 0,
      verifiedEmailCount: (json['verifiedEmailCount'] as num?)?.toInt() ?? 0,
      disabledAccountCount:
          (json['disabledAccountCount'] as num?)?.toInt() ?? 0,
      totalBalanceCredits: (json['totalBalanceCredits'] as num?)?.toInt() ?? 0,
      usage: UsageMetrics.fromJson(json['usage']),
      funding: FundingMetrics.fromJson(json['funding']),
    );
  }

  static const zero = AdminOverview(
    accountCount: 0,
    registeredAccountCount: 0,
    verifiedEmailCount: 0,
    disabledAccountCount: 0,
    totalBalanceCredits: 0,
    usage: UsageMetrics.zero,
    funding: FundingMetrics.zero,
  );

  final int accountCount;
  final int registeredAccountCount;
  final int verifiedEmailCount;
  final int disabledAccountCount;
  final int totalBalanceCredits;
  final UsageMetrics usage;
  final FundingMetrics funding;
}

class ManagedAccount {
  const ManagedAccount({
    required this.accountId,
    required this.username,
    required this.email,
    required this.emailVerified,
    required this.displayName,
    required this.role,
    required this.isGuest,
    required this.disabled,
    required this.balanceCredits,
    required this.usage,
    required this.funding,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ManagedAccount.fromJson(Map<String, Object?> json) => ManagedAccount(
    accountId: json['accountId'] as String? ?? '',
    username: json['username'] as String?,
    email: json['email'] as String?,
    emailVerified: json['emailVerified'] as bool? ?? false,
    displayName: json['displayName'] as String? ?? '访客账户',
    role: json['role'] as String? ?? 'user',
    isGuest: json['isGuest'] as bool? ?? true,
    disabled: json['disabled'] as bool? ?? false,
    balanceCredits: (json['balanceCredits'] as num?)?.toInt() ?? 0,
    usage: UsageMetrics.fromJson(json['usage']),
    funding: FundingMetrics.fromJson(json['funding']),
    createdAt:
        DateTime.tryParse(json['createdAt'] as String? ?? '') ??
        DateTime.fromMillisecondsSinceEpoch(0),
    updatedAt:
        DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
        DateTime.fromMillisecondsSinceEpoch(0),
  );

  final String accountId;
  final String? username;
  final String? email;
  final bool emailVerified;
  final String displayName;
  final String role;
  final bool isGuest;
  final bool disabled;
  final int balanceCredits;
  final UsageMetrics usage;
  final FundingMetrics funding;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isAdmin => role == 'admin';
}

class AdminDashboardData {
  const AdminDashboardData({
    required this.accounts,
    required this.overview,
    required this.pricing,
  });

  factory AdminDashboardData.fromJson(Map<String, Object?> json) =>
      AdminDashboardData(
        accounts: [
          for (final item in json['accounts'] as List? ?? const [])
            if (item is Map)
              ManagedAccount.fromJson(
                item.map(
                  (key, value) => MapEntry(key.toString(), value as Object?),
                ),
              ),
        ],
        overview: AdminOverview.fromJson(json['overview']),
        pricing: AdminPricing.fromJson(json['pricing']),
      );

  final List<ManagedAccount> accounts;
  final AdminOverview overview;
  final AdminPricing pricing;
}

class ModelPriceTier {
  const ModelPriceTier({
    required this.upToInputTokens,
    required this.inputPerMillion,
    required this.outputPerMillion,
  });

  factory ModelPriceTier.fromJson(Object? value) {
    final json = _objectMap(value);
    return ModelPriceTier(
      upToInputTokens: (json['upToInputTokens'] as num?)?.toInt() ?? 0,
      inputPerMillion: (json['inputPerMillion'] as num?)?.toDouble() ?? 0,
      outputPerMillion: (json['outputPerMillion'] as num?)?.toDouble() ?? 0,
    );
  }

  final int upToInputTokens;
  final double inputPerMillion;
  final double outputPerMillion;
}

class ModelCatalogPricing {
  const ModelCatalogPricing({
    required this.profile,
    required this.currency,
    required this.sourceUrl,
    required this.checkedAt,
    required this.tiers,
  });

  factory ModelCatalogPricing.fromJson(Object? value) {
    final json = _objectMap(value);
    return ModelCatalogPricing(
      profile: json['profile'] as String? ?? 'manual',
      currency: json['currency'] as String? ?? 'cny',
      sourceUrl: json['sourceUrl'] as String?,
      checkedAt: json['checkedAt'] as String?,
      tiers: [
        for (final item in json['tiers'] as List? ?? const [])
          ModelPriceTier.fromJson(item),
      ],
    );
  }

  final String profile;
  final String currency;
  final String? sourceUrl;
  final String? checkedAt;
  final List<ModelPriceTier> tiers;
}

class AvailableModel {
  const AvailableModel({
    required this.id,
    required this.name,
    required this.version,
    required this.domain,
    required this.status,
    required this.contextWindow,
    required this.maxInputTokens,
    required this.maxOutputTokens,
    required this.supportsStructuredOutput,
    required this.suggestedPricing,
  });

  factory AvailableModel.fromJson(Object? value) {
    final json = _objectMap(value);
    return AvailableModel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? json['id'] as String? ?? '',
      version: json['version'] as String?,
      domain: json['domain'] as String?,
      status: json['status'] as String?,
      contextWindow: (json['contextWindow'] as num?)?.toInt(),
      maxInputTokens: (json['maxInputTokens'] as num?)?.toInt(),
      maxOutputTokens: (json['maxOutputTokens'] as num?)?.toInt(),
      supportsStructuredOutput:
          json['supportsStructuredOutput'] as bool? ?? false,
      suggestedPricing: json['suggestedPricing'] is Map
          ? ModelCatalogPricing.fromJson(json['suggestedPricing'])
          : null,
    );
  }

  final String id;
  final String name;
  final String? version;
  final String? domain;
  final String? status;
  final int? contextWindow;
  final int? maxInputTokens;
  final int? maxOutputTokens;
  final bool supportsStructuredOutput;
  final ModelCatalogPricing? suggestedPricing;

  bool get isRetiring => status?.toLowerCase() == 'retiring';
}

class AdminModelCatalog {
  const AdminModelCatalog({
    required this.activeModelId,
    required this.models,
    required this.source,
    required this.refreshedAt,
    required this.warning,
  });

  factory AdminModelCatalog.fromJson(Map<String, Object?> json) {
    final active = _objectMap(json['active']);
    return AdminModelCatalog(
      activeModelId: active['id'] as String? ?? '',
      models: [
        for (final item in json['models'] as List? ?? const [])
          AvailableModel.fromJson(item),
      ],
      source: json['source'] as String? ?? 'configured',
      refreshedAt: DateTime.tryParse(json['refreshedAt'] as String? ?? ''),
      warning: json['warning'] as String?,
    );
  }

  final String activeModelId;
  final List<AvailableModel> models;
  final String source;
  final DateTime? refreshedAt;
  final String? warning;
}

class AdminPricing {
  const AdminPricing({
    required this.modelId,
    required this.profile,
    required this.currency,
    required this.sourceUrl,
    required this.checkedAt,
    required this.tiers,
    required this.initialCredits,
    required this.minimumBalanceToStart,
    required this.minimumChargeCredits,
    required this.creditsPerCurrencyUnit,
    required this.markupMultiplier,
    required this.updatedAt,
  });

  factory AdminPricing.fromJson(Object? value) {
    final json = _objectMap(value);
    return AdminPricing(
      modelId:
          json['modelId'] as String? ?? json['profile'] as String? ?? '未配置',
      profile: json['profile'] as String? ?? '未配置',
      currency: json['currency'] as String? ?? 'cny',
      sourceUrl: json['sourceUrl'] as String?,
      checkedAt: json['checkedAt'] as String?,
      tiers: [
        for (final item in json['tiers'] as List? ?? const [])
          ModelPriceTier.fromJson(item),
      ],
      initialCredits: (json['initialCredits'] as num?)?.toInt() ?? 0,
      minimumBalanceToStart:
          (json['minimumBalanceToStart'] as num?)?.toInt() ?? 1,
      minimumChargeCredits:
          (json['minimumChargeCredits'] as num?)?.toInt() ?? 1,
      creditsPerCurrencyUnit:
          (json['creditsPerCurrencyUnit'] as num?)?.toInt() ?? 100,
      markupMultiplier: (json['markupMultiplier'] as num?)?.toDouble() ?? 1,
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? ''),
    );
  }

  static const fallback = AdminPricing(
    modelId: '未配置',
    profile: '未配置',
    currency: 'cny',
    sourceUrl: null,
    checkedAt: null,
    tiers: [],
    initialCredits: 0,
    minimumBalanceToStart: 1,
    minimumChargeCredits: 1,
    creditsPerCurrencyUnit: 100,
    markupMultiplier: 1,
    updatedAt: null,
  );

  final String modelId;
  final String profile;
  final String currency;
  final String? sourceUrl;
  final String? checkedAt;
  final List<ModelPriceTier> tiers;
  final int initialCredits;
  final int minimumBalanceToStart;
  final int minimumChargeCredits;
  final int creditsPerCurrencyUnit;
  final double markupMultiplier;
  final DateTime? updatedAt;

  double get currencyPerCredit => 1 / creditsPerCurrencyUnit;
}
