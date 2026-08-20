from aws_cdk import (
    Stack,
    RemovalPolicy,
    Duration,
    CfnOutput,
    aws_s3 as s3,
    aws_dynamodb as dynamodb,
    aws_lambda as _lambda,
    aws_s3_notifications as s3n,
    aws_iam as iam,
    aws_apigateway as apigateway,
)

from constructs import Construct


class FmsAiAgentcoreStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        knowledge_bucket = s3.Bucket(
            self,
            "FmsKnowledgeBucket",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
        )

        client_documents_bucket = s3.Bucket(
            self,
            "FmsClientDocumentsBucket",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.PUT],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                    exposed_headers=["ETag"],
                    max_age=3000,
                )
            ],
        )

        output_bucket = s3.Bucket(
            self,
            "FmsAiOutputBucket",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.RETAIN,
        )

        documents_table = dynamodb.Table(
            self,
            "FmsDocumentsTable",
            partition_key=dynamodb.Attribute(
                name="document_id",
                type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        audit_log_table = dynamodb.Table(
            self,
            "FmsAiAuditLogTable",
            partition_key=dynamodb.Attribute(
                name="log_id",
                type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Tracks async audit-planning generation jobs so the frontend
        # can poll for completion instead of holding open a single
        # long-running HTTP request (which hits API Gateway's 29s ceiling).
        jobs_table = dynamodb.Table(
            self,
            "FmsAiJobsTable",
            partition_key=dynamodb.Attribute(
                name="job_id",
                type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
            time_to_live_attribute="ttl",
        )

        upload_lambda = _lambda.Function(
            self,
            "UploadProcessor",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.lambda_handler",
            code=_lambda.Code.from_asset("lambda/upload_processor_new"),
            timeout=Duration.seconds(300),
            memory_size=512,
            environment={
                "OUTPUT_BUCKET": output_bucket.bucket_name,
            },
        )

        client_documents_bucket.add_event_notification(
            s3.EventType.OBJECT_CREATED,
            s3n.LambdaDestination(upload_lambda),
        )

        client_documents_bucket.grant_read(upload_lambda)
        output_bucket.grant_read_write(upload_lambda)

        upload_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "textract:StartDocumentTextDetection",
                    "textract:GetDocumentTextDetection",
                ],
                resources=["*"],
            )
        )

        summary_lambda = _lambda.Function(
            self,
            "FinancialSummaryAgent",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.lambda_handler",
            code=_lambda.Code.from_asset("lambda/financial_summary_agent"),
            timeout=Duration.minutes(15),
            memory_size=2048,
            environment={
                "OUTPUT_BUCKET": output_bucket.bucket_name,
                "DOCUMENTS_TABLE": documents_table.table_name,
                "REPORTS_TABLE_NAME": documents_table.table_name,
                "REPORTS_TABLE": documents_table.table_name,
                "AUDIT_LOG_TABLE": audit_log_table.table_name,
                "MODEL_ID": "eu.anthropic.claude-sonnet-4-6",
                "BEDROCK_MODEL_ID": "eu.anthropic.claude-sonnet-4-6",
                "KNOWLEDGE_BASE_ID": "1ZCVTUEAH8",
            },
        )

        output_bucket.grant_read_write(summary_lambda)
        documents_table.grant_read_write_data(summary_lambda)
        audit_log_table.grant_read_write_data(summary_lambda)

        summary_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:Retrieve",
                    "bedrock:RetrieveAndGenerate",
                ],
                resources=["*"],
            )
        )

        output_bucket.add_event_notification(
            s3.EventType.OBJECT_CREATED,
            s3n.LambdaDestination(summary_lambda),
            s3.NotificationKeyFilter(
                prefix="extracted-text/",
                suffix=".txt",
            ),
        )

        report_api_lambda = _lambda.Function(
            self,
            "ReportApi",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.lambda_handler",
            code=_lambda.Code.from_asset("lambda/report_api"),
            timeout=Duration.seconds(30),
            memory_size=512,
            environment={
                "DOCUMENTS_TABLE": documents_table.table_name,
                "REPORTS_TABLE_NAME": documents_table.table_name,
                "REPORTS_TABLE": documents_table.table_name,
                "OUTPUT_BUCKET": output_bucket.bucket_name,
                "REPORT_BUCKET": output_bucket.bucket_name,
            },
        )

        documents_table.grant_read_data(report_api_lambda)
        output_bucket.grant_read(report_api_lambda)

        report_api_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "dynamodb:GetItem",
                    "dynamodb:Query",
                    "dynamodb:Scan",
                    "dynamodb:BatchGetItem",
                    "dynamodb:DescribeTable",
                ],
                resources=[
                    documents_table.table_arn,
                    f"{documents_table.table_arn}/index/*",
                ],
            )
        )

        # Worker Lambda: performs the actual slow AgentCore invocation.
        # Triggered asynchronously (fire-and-forget) by ChatbotLambda so
        # it can run for several minutes without being constrained by API
        # Gateway's 29-second integration timeout.
        audit_planning_worker_lambda = _lambda.Function(
            self,
            "AuditPlanningWorker",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.lambda_handler",
            code=_lambda.Code.from_asset("lambda/audit_planning_worker"),
            timeout=Duration.minutes(10),
            memory_size=1024,
            environment={
                "JOBS_TABLE": jobs_table.table_name,
                "AGENTCORE_REGION": "eu-central-1",
                "AUDIT_PLANNING_AGENT_RUNTIME_ARN": "arn:aws:bedrock-agentcore:eu-central-1:497675597422:runtime/AuditPlanningAgent-ZKNs0d8l0Y",
                "AUDIT_PLANNING_AGENT_QUALIFIER": "DEFAULT",
            },
        )

        jobs_table.grant_read_write_data(audit_planning_worker_lambda)

        audit_planning_worker_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock-agentcore:InvokeAgentRuntime",
                ],
                resources=["*"],
            )
        )

        chatbot_lambda = _lambda.Function(
            self,
            "ChatbotLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="app.lambda_handler",
            code=_lambda.Code.from_asset("lambda/chatbot"),
            timeout=Duration.seconds(300),
            memory_size=2048,
            environment={
                "DOCUMENTS_TABLE": documents_table.table_name,
                "REPORTS_TABLE_NAME": documents_table.table_name,
                "REPORTS_TABLE": documents_table.table_name,
                "CHAT_HISTORY_TABLE": audit_log_table.table_name,
                "AUDIT_LOG_TABLE": audit_log_table.table_name,
                "OUTPUT_BUCKET": output_bucket.bucket_name,
                "REPORT_BUCKET": output_bucket.bucket_name,
                "MODEL_ID": "eu.anthropic.claude-sonnet-4-6",
                "BEDROCK_MODEL_ID": "eu.anthropic.claude-sonnet-4-6",
                "KNOWLEDGE_BASE_ID": "1ZCVTUEAH8",
                "MAX_HISTORY_MESSAGES": "10",
                "MAX_REPORT_CONTEXT_CHARS": "18000",
                "JOBS_TABLE": jobs_table.table_name,
                "AUDIT_PLANNING_WORKER_FUNCTION_NAME": audit_planning_worker_lambda.function_name,
            },
        )

        documents_table.grant_read_data(chatbot_lambda)
        audit_log_table.grant_read_write_data(chatbot_lambda)
        output_bucket.grant_read(chatbot_lambda)
        jobs_table.grant_read_write_data(chatbot_lambda)
        audit_planning_worker_lambda.grant_invoke(chatbot_lambda)

        chatbot_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:Retrieve",
                    "bedrock:RetrieveAndGenerate",
                ],
                resources=["*"],
            )
        )

        chatbot_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                    "dynamodb:Query",
                    "dynamodb:Scan",
                    "dynamodb:BatchGetItem",
                    "dynamodb:DescribeTable",
                ],
                resources=[
                    documents_table.table_arn,
                    audit_log_table.table_arn,
                    jobs_table.table_arn,
                    f"{documents_table.table_arn}/index/*",
                    f"{audit_log_table.table_arn}/index/*",
                    f"{jobs_table.table_arn}/index/*",
                ],
            )
        )

        api = apigateway.RestApi(
            self,
            "FmsReportsApi",
            rest_api_name="FMS Reports API",
            description="API to fetch generated financial audit reports",
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=["GET", "POST", "OPTIONS"],
                allow_headers=[
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Api-Key",
                    "X-Amz-Security-Token",
                ],
            ),
        )

        api.root.add_method(
            "GET",
            apigateway.LambdaIntegration(report_api_lambda),
        )

        documents_resource = api.root.add_resource("documents")

        documents_resource.add_method(
            "GET",
            apigateway.LambdaIntegration(report_api_lambda),
        )

        single_document_resource = documents_resource.add_resource("{document_id}")

        single_document_resource.add_method(
            "GET",
            apigateway.LambdaIntegration(report_api_lambda),
        )

        chat_resource = api.root.add_resource("chat")

        chat_resource.add_method(
            "POST",
            apigateway.LambdaIntegration(chatbot_lambda),
        )

        history_resource = chat_resource.add_resource("history")

        history_report_resource = history_resource.add_resource("{reportId}")

        history_report_resource.add_method(
            "GET",
            apigateway.LambdaIntegration(chatbot_lambda),
        )

        # Polling endpoint: frontend calls GET /chat/status/{jobId}
        # every few seconds to check if the async audit planning job
        # has completed.
        status_resource = chat_resource.add_resource("status")

        status_job_resource = status_resource.add_resource("{jobId}")

        status_job_resource.add_method(
            "GET",
            apigateway.LambdaIntegration(chatbot_lambda),
        )

        upload_url_lambda = _lambda.Function(
            self,
            "UploadUrlLambda",
            runtime=_lambda.Runtime.NODEJS_20_X,
            handler="index.handler",
            code=_lambda.Code.from_asset("upload-url-lambda"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "BUCKET_NAME": client_documents_bucket.bucket_name,
            },
        )

        client_documents_bucket.grant_put(upload_url_lambda)

        upload_resource = api.root.add_resource("upload-url")

        upload_resource.add_method(
            "POST",
            apigateway.LambdaIntegration(upload_url_lambda),
        )

        CfnOutput(
            self,
            "ReportsApiUrl",
            value=f"{api.url}documents",
        )

        CfnOutput(
            self,
            "UploadApiUrl",
            value=f"{api.url}upload-url",
        )

        CfnOutput(
            self,
            "ChatHistoryApiUrl",
            value=f"{api.url}chat/history/{{reportId}}",
        )

        CfnOutput(
            self,
            "ChatApiUrl",
            value=f"{api.url}chat",
        )

        CfnOutput(
            self,
            "ChatStatusApiUrl",
            value=f"{api.url}chat/status/{{jobId}}",
        )

        CfnOutput(
            self,
            "FmsReportsApiEndpoint",
            value=api.url,
        )