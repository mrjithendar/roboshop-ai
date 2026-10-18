pipeline { 

    agent any
    options { disableConcurrentBuilds() }

    environment {
        tfDir = "terraform"
        region = "us-east-1"
        AWSCreds = credentials('awsCreds')
        AWS_ACCESS_KEY_ID = "${AWSCreds_USR}"
        AWS_SECRET_ACCESS_KEY = "${AWSCreds_PSW}"
        AWS_DEFAULT_REGION = "us-east-1"
    }

    stages { 
        stage ('Creating AWS VPC DKODE Applications') { 
            steps {
                sh "terraform --version"
                sh "terraform init -reconfigure"
                sh "terraform validate"
                sh "terraform plan -var-file=vars/dev.tfvars -out=planfile"
                sh "terraform apply planfile"
            }
        } 
    } 
} 